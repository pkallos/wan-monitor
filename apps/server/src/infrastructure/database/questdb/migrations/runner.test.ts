import { describe, expect, it } from "@effect/vitest";
import { NETWORK_METRICS_COLUMNS } from "@wan-monitor/shared/db-schema";
import { Effect } from "effect";
import {
  type Migration,
  type MigrationError,
  stickyError,
} from "@/infrastructure/database/questdb/migrations/migration";
import { runMigrations } from "@/infrastructure/database/questdb/migrations/runner";
import type { TableShape } from "@/infrastructure/database/questdb/migrations/schema";
import {
  canonicalLiveColumns,
  createFakeContext,
  terminal,
  transient,
} from "@/infrastructure/database/questdb/test-utils/fake-migration-context";

const target: TableShape = {
  columns: NETWORK_METRICS_COLUMNS,
  groupColumns: ["source", "host"],
};

const migration = (version: number, failure?: MigrationError): Migration => ({
  version,
  name: `step-${version}`,
  up: (ctx) =>
    ctx
      .query(`-- up v${version}`)
      .pipe(
        Effect.andThen(
          failure === undefined ? Effect.void : Effect.fail(failure)
        )
      ),
});

const ledgerInsert = (version: number) =>
  `INSERT INTO metrics_migrations VALUES (${version}, 'step-${version}', now())`;

describe("runMigrations", () => {
  it.effect(
    "creates the ledger, applies pending migrations in order and records each after it ran",
    () => {
      const { ctx, statements, ledger } = createFakeContext({
        table: "metrics",
        tables: ["metrics"],
      });

      return Effect.gen(function* () {
        yield* runMigrations(ctx, {
          migrations: [migration(1), migration(2)],
          target,
        });

        const index = (sql: string) => statements.indexOf(sql);
        expect(statements[0]).toBe(
          "CREATE TABLE IF NOT EXISTS metrics_migrations (version INT, name STRING, applied_at TIMESTAMP) TIMESTAMP(applied_at) PARTITION BY NONE"
        );
        expect(index("-- up v1")).toBeGreaterThan(0);
        expect(index(ledgerInsert(1))).toBeGreaterThan(index("-- up v1"));
        expect(index("-- up v2")).toBeGreaterThan(index(ledgerInsert(1)));
        expect(index(ledgerInsert(2))).toBeGreaterThan(index("-- up v2"));
        expect(ledger).toEqual([1, 2]);
      });
    }
  );

  it.effect("skips migrations the ledger already holds", () => {
    const { ctx, statements, ledger } = createFakeContext({
      table: "metrics",
      tables: ["metrics"],
      ledger: [1],
    });

    return Effect.gen(function* () {
      yield* runMigrations(ctx, {
        migrations: [migration(1), migration(2)],
        target,
      });

      expect(statements).not.toContain("-- up v1");
      expect(statements).toContain("-- up v2");
      expect(ledger).toEqual([1, 2]);
    });
  });

  it.effect("runs nothing when the ledger is current", () => {
    const { ctx, statements } = createFakeContext({
      table: "metrics",
      tables: ["metrics"],
      ledger: [1, 2],
    });

    return Effect.gen(function* () {
      yield* runMigrations(ctx, {
        migrations: [migration(1), migration(2)],
        target,
      });

      expect(statements.some((sql) => sql.startsWith("-- up"))).toBe(false);
      expect(statements.some((sql) => sql.startsWith("INSERT INTO"))).toBe(
        false
      );
    });
  });

  it.effect(
    "stops at the first failure, keeps its kind and names its version",
    () => {
      const { ctx, statements, ledger } = createFakeContext({
        table: "metrics",
        tables: ["metrics"],
      });

      return Effect.gen(function* () {
        const error = yield* Effect.flip(
          runMigrations(ctx, {
            migrations: [
              migration(1),
              migration(2, terminal("bad data")),
              migration(3),
            ],
            target,
          })
        );

        expect(error.kind).toBe("terminal");
        expect(error.message).toContain("v2");
        expect(error.message).toContain("step-2");
        expect(error.message).toContain("bad data");
        expect(statements).not.toContain("-- up v3");
        expect(ledger).toEqual([1]);
      });
    }
  );

  it.effect("reports a failed statement as transient", () => {
    const { ctx } = createFakeContext({
      table: "metrics",
      tables: ["metrics"],
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        runMigrations(ctx, {
          migrations: [migration(1, transient("connection reset"))],
          target,
        })
      );

      expect(error.kind).toBe("transient");
      expect(error.message).toContain("v1");
      expect(error.message).toContain("connection reset");
    });
  });

  it.effect(
    "recovers an interrupted rebuild before applying any migration",
    () => {
      const { ctx, statements } = createFakeContext({
        table: "metrics",
        tables: ["metrics__previous"],
      });

      return Effect.gen(function* () {
        yield* runMigrations(ctx, { migrations: [migration(1)], target });

        const restore = statements.indexOf(
          "RENAME TABLE metrics__previous TO metrics"
        );
        expect(restore).toBeGreaterThanOrEqual(0);
        expect(statements.indexOf("-- up v1")).toBeGreaterThan(restore);
      });
    }
  );

  it.effect("announces the recovery of an interrupted rebuild first", () => {
    const { ctx } = createFakeContext({
      table: "metrics",
      tables: ["metrics__previous"],
    });
    const announced: string[] = [];

    return Effect.gen(function* () {
      yield* runMigrations(ctx, {
        migrations: [migration(1)],
        target,
        onProgress: (step) => Effect.sync(() => void announced.push(step)),
      });

      expect(announced).toEqual([
        "recovering an interrupted rebuild of metrics",
        "v1: step-1",
      ]);
    });
  });

  it.effect(
    "refuses a ledger ahead of the code before touching any table",
    () => {
      const { ctx, statements } = createFakeContext({
        table: "metrics",
        tables: ["metrics", "metrics__rebuild"],
        ledger: [1, 2, 3],
      });

      return Effect.gen(function* () {
        const error = yield* Effect.flip(
          runMigrations(ctx, {
            migrations: [migration(1), migration(2)],
            target,
          })
        );

        expect(error.kind).toBe("terminal");
        expect(error.message).toContain("version 3");
        expect(statements.some((sql) => /^(DROP|RENAME|-- up)/.test(sql))).toBe(
          false
        );
      });
    }
  );

  it.effect(
    "refuses a table that drifts from the schema after migrating",
    () => {
      const { ctx } = createFakeContext({
        table: "metrics",
        tables: ["metrics"],
        ledger: [1, 2],
        columns: {
          metrics: canonicalLiveColumns.map((column) =>
            column.name === "isp" ? { ...column, type: "VARCHAR" } : column
          ),
        },
      });

      return Effect.gen(function* () {
        const error = yield* Effect.flip(
          runMigrations(ctx, {
            migrations: [migration(1), migration(2)],
            target,
          })
        );

        expect(error.kind).toBe("terminal");
        expect(error.message).toContain("isp is VARCHAR, expected STRING");
        expect(error.message).toContain("metrics_migrations");
      });
    }
  );

  it.effect("refuses a table that is missing after migrating", () => {
    const { ctx } = createFakeContext({ table: "metrics", ledger: [1, 2] });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        runMigrations(ctx, {
          migrations: [migration(1), migration(2)],
          target,
        })
      );

      expect(error.kind).toBe("terminal");
      expect(error.message).toContain("metrics does not exist");
    });
  });

  it.effect("announces each pending migration before running it", () => {
    const { ctx } = createFakeContext({
      table: "metrics",
      tables: ["metrics"],
      ledger: [1],
    });
    const announced: string[] = [];

    return Effect.gen(function* () {
      yield* runMigrations(ctx, {
        migrations: [migration(1), migration(2)],
        target,
        onProgress: (step) =>
          Effect.sync(() => {
            announced.push(step);
          }),
      });

      expect(announced).toEqual(["v2: step-2"]);
    });
  });

  describe("the schema check after migrating", () => {
    const current = (columns: typeof canonicalLiveColumns) =>
      createFakeContext({
        table: "metrics",
        tables: ["metrics"],
        ledger: [1, 2],
        columns: { metrics: columns },
      });

    const refusal = (columns: typeof canonicalLiveColumns) => {
      const { ctx } = current(columns);
      return Effect.flip(
        runMigrations(ctx, {
          migrations: [migration(1), migration(2)],
          target,
        })
      );
    };

    it.effect("refuses a column the schema does not declare", () =>
      Effect.gen(function* () {
        const error = yield* refusal([
          ...canonicalLiveColumns,
          { name: "note", type: "STRING", designated: false },
        ]);

        expect(error.kind).toBe("terminal");
        expect(error.message).toContain("unexpected column note");
      })
    );

    it.effect("refuses a column the table lacks", () =>
      Effect.gen(function* () {
        const error = yield* refusal(
          canonicalLiveColumns.filter((column) => column.name !== "isp")
        );

        expect(error.kind).toBe("terminal");
        expect(error.message).toContain("missing column isp");
      })
    );

    it.effect("refuses a table without the designated timestamp", () =>
      Effect.gen(function* () {
        const error = yield* refusal(
          canonicalLiveColumns.map((column) => ({
            ...column,
            designated: false,
          }))
        );

        expect(error.kind).toBe("terminal");
        expect(error.message).toContain("designated timestamp");
      })
    );
  });

  it.effect("announces a migration before it runs", () => {
    const events: string[] = [];
    const recorded = (version: number): Migration => ({
      version,
      name: `step-${version}`,
      up: () => Effect.sync(() => void events.push(`up v${version}`)),
    });
    const { ctx } = createFakeContext({
      table: "metrics",
      tables: ["metrics"],
    });

    return Effect.gen(function* () {
      yield* runMigrations(ctx, {
        migrations: [recorded(1), recorded(2)],
        target,
        onProgress: (step) =>
          Effect.sync(() => void events.push(`announce ${step}`)),
      });

      expect(events).toEqual([
        "announce v1: step-1",
        "up v1",
        "announce v2: step-2",
        "up v2",
      ]);
    });
  });

  describe("a sticky failure", () => {
    const setup = () =>
      createFakeContext({ table: "metrics", tables: ["metrics"] });
    const run = (
      ctx: ReturnType<typeof setup>["ctx"],
      migrations: readonly Migration[]
    ) => runMigrations(ctx, { migrations, target });

    it.effect(
      "is recorded under the negated version, not as an applied one",
      () => {
        const { ctx, ledger, failures, statements } = setup();

        return Effect.gen(function* () {
          const error = yield* Effect.flip(
            run(ctx, [
              migration(1),
              migration(2, stickyError("verify", "it's damaged")),
            ])
          );

          expect(error.kind).toBe("terminal");
          expect(ledger).toEqual([1]);
          expect(failures.get(2)).toBe("it's damaged");
          expect(statements).toContain(
            "INSERT INTO metrics_migrations VALUES (-2, 'it''s damaged', now())"
          );
        });
      }
    );

    it.effect(
      "makes every retry refuse with the stored message and run nothing",
      () => {
        const { ctx, ledger, statements } = setup();

        return Effect.gen(function* () {
          yield* Effect.flip(
            run(ctx, [
              migration(1),
              migration(2, stickyError("verify", "damaged")),
            ])
          );

          for (let retry = 0; retry < 2; retry += 1) {
            const error = yield* Effect.flip(
              run(ctx, [migration(1), migration(2)])
            );

            expect(error.kind).toBe("terminal");
            expect(error.message).toContain("Migration v2 (step-2)");
            expect(error.message).toContain("damaged");
            expect(error.message).toContain("drop metrics_migrations");
          }
          expect(statements.filter((sql) => sql === "-- up v2")).toHaveLength(
            1
          );
          expect(ledger).toEqual([1]);
        });
      }
    );

    it.effect("is not recorded for a failure that is not sticky", () => {
      const { ctx, failures } = setup();

      return Effect.gen(function* () {
        yield* Effect.flip(
          run(ctx, [migration(1, terminal("needs a person"))])
        );

        expect(failures.size).toBe(0);
      });
    });

    it.effect("is left out of the applied version", () => {
      const { ctx, statements } = setup();

      return Effect.gen(function* () {
        yield* run(ctx, [migration(1)]);

        expect(statements).toContain(
          "SELECT max(version) AS v FROM metrics_migrations WHERE version > 0"
        );
      });
    });
  });
});
