import { describe, expect, it } from "@effect/vitest";
import { NETWORK_METRICS_COLUMNS } from "@wan-monitor/shared/db-schema";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import {
  rebuildTable,
  recoverTableState,
} from "@/infrastructure/database/questdb/migrations/rebuild";
import type { TableShape } from "@/infrastructure/database/questdb/migrations/schema";
import {
  canonicalLiveColumns,
  createFakeContext,
  type FakeDigest,
  type FakeWalStatus,
  sameDigest,
  transient,
} from "@/infrastructure/database/questdb/test-utils/fake-migration-context";

const shape: TableShape = {
  columns: NETWORK_METRICS_COLUMNS,
  groupColumns: ["source", "host"],
};

const otherDigest: FakeDigest = {
  totals: { ...sameDigest.totals, row_count: "2" },
  groups: sameDigest.groups,
};

const settled = (txn: number): FakeWalStatus => ({
  suspended: false,
  writerTxn: txn,
  sequencerTxn: txn,
});

const indexOfStatement = (statements: readonly string[], prefix: string) =>
  statements.findIndex((sql) => sql.startsWith(prefix));

const hasStatement = (statements: readonly string[], prefix: string) =>
  indexOfStatement(statements, prefix) >= 0;

describe("rebuildTable", () => {
  const walTables = {
    metrics: settled(5),
    metrics__rebuild: settled(1),
  };

  it.effect(
    "copies into a canonical table, verifies it, swaps it in and drops the original",
    () => {
      const { ctx, statements, tables } = createFakeContext({
        table: "metrics",
        tables: ["metrics"],
        wal: walTables,
      });

      return Effect.gen(function* () {
        yield* rebuildTable(ctx, shape);

        const order = [
          "DROP TABLE IF EXISTS metrics__rebuild",
          "CREATE TABLE IF NOT EXISTS metrics__rebuild",
          "INSERT INTO metrics__rebuild",
          "RENAME TABLE metrics TO metrics__previous",
          "RENAME TABLE metrics__rebuild TO metrics",
          "DROP TABLE metrics__previous",
        ].map((prefix) => indexOfStatement(statements, prefix));
        expect(order.every((index) => index >= 0)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect([...tables]).toEqual(["metrics"]);
      });
    }
  );

  it.effect("waits for a WAL source to apply its pending transactions", () => {
    let reads = 0;
    const { ctx, statements } = createFakeContext({
      table: "metrics",
      tables: ["metrics"],
      wal: {
        ...walTables,
        metrics: () => {
          reads += 1;
          return reads < 3
            ? { suspended: false, writerTxn: 4, sequencerTxn: 5 }
            : settled(5);
        },
      },
    });

    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(rebuildTable(ctx, shape));
      yield* TestClock.adjust(Duration.seconds(5));
      yield* Fiber.join(fiber);

      expect(reads).toBeGreaterThanOrEqual(3);
      expect(hasStatement(statements, "RENAME TABLE metrics TO")).toBe(true);
    });
  });

  it.effect("refuses a suspended source before creating anything", () => {
    const { ctx, statements } = createFakeContext({
      table: "metrics",
      tables: ["metrics"],
      wal: {
        ...walTables,
        metrics: { suspended: true, writerTxn: 4, sequencerTxn: 5 },
      },
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(rebuildTable(ctx, shape));

      expect(error.kind).toBe("terminal");
      expect(error.message).toContain("suspended");
      expect(hasStatement(statements, "CREATE TABLE")).toBe(false);
    });
  });

  it.effect("refuses a suspended copy and drops it", () => {
    const { ctx, statements } = createFakeContext({
      table: "metrics",
      tables: ["metrics"],
      wal: {
        ...walTables,
        metrics__rebuild: { suspended: true, writerTxn: 0, sequencerTxn: 1 },
      },
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(rebuildTable(ctx, shape));

      expect(error.kind).toBe("terminal");
      expect(error.message).toContain("metrics__rebuild was suspended");
      expect(error.message).toContain("disk");
      expect(error.message).toContain("metrics is unchanged");
      expect(error.message).not.toContain("RESUME WAL");
      expect(hasStatement(statements, "RENAME TABLE")).toBe(false);
      expect(statements.at(-1)).toBe("DROP TABLE IF EXISTS metrics__rebuild");
    });
  });

  it.effect(
    "drops the copy and never swaps when it differs from the source",
    () => {
      const { ctx, statements, tables } = createFakeContext({
        table: "metrics",
        tables: ["metrics"],
        wal: walTables,
        digestFor: (table) =>
          table === "metrics__rebuild" ? otherDigest : sameDigest,
      });

      return Effect.gen(function* () {
        const error = yield* Effect.flip(rebuildTable(ctx, shape));

        expect(error.kind).toBe("terminal");
        expect(error.message).toContain("row_count: 3 in source, 2 in copy");
        expect(error.message).toContain("metrics__rebuild was removed");
        expect(error.message).toContain("metrics is unchanged");
        expect(hasStatement(statements, "RENAME TABLE")).toBe(false);
        expect([...tables]).toEqual(["metrics"]);
      });
    }
  );

  it.effect("drops the copy as stale when the source took new writes", () => {
    let reads = 0;
    const { ctx, statements, tables } = createFakeContext({
      table: "metrics",
      tables: ["metrics"],
      wal: {
        ...walTables,
        metrics: () => {
          reads += 1;
          return {
            suspended: false,
            writerTxn: reads + 4,
            sequencerTxn: reads + 4,
          };
        },
      },
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(rebuildTable(ctx, shape));

      expect(error.kind).toBe("transient");
      expect(error.message).toContain("changed while it was copied");
      expect(hasStatement(statements, "RENAME TABLE")).toBe(false);
      expect([...tables]).toEqual(["metrics"]);
    });
  });

  it.effect(
    "drops the copy as stale when only the source's sequencerTxn moved",
    () => {
      let reads = 0;
      const { ctx, statements, tables } = createFakeContext({
        table: "metrics",
        tables: ["metrics"],
        wal: {
          ...walTables,
          metrics: () => {
            reads += 1;
            return reads === 1
              ? settled(5)
              : { suspended: false, writerTxn: 5, sequencerTxn: 6 };
          },
        },
      });

      return Effect.gen(function* () {
        const error = yield* Effect.flip(rebuildTable(ctx, shape));

        expect(error.kind).toBe("transient");
        expect(error.message).toContain("changed while it was copied");
        expect(hasStatement(statements, "RENAME TABLE")).toBe(false);
        expect([...tables]).toEqual(["metrics"]);
      });
    }
  );

  it.effect(
    "keeps the original when the swapped-in table fails its re-check",
    () => {
      const { ctx, statements, tables } = createFakeContext({
        table: "metrics",
        tables: ["metrics"],
        wal: walTables,
        digestFor: (table, run) =>
          table === "metrics" && run.some((sql) => sql.startsWith("RENAME"))
            ? otherDigest
            : sameDigest,
      });

      return Effect.gen(function* () {
        const error = yield* Effect.flip(rebuildTable(ctx, shape));

        expect(error.kind).toBe("terminal");
        expect(error.message).toContain(
          "any rows of metrics__previous that metrics lacks"
        );
        expect(error.message).toContain(
          "drops metrics__previous once they match"
        );
        expect(hasStatement(statements, "DROP TABLE metrics__previous")).toBe(
          false
        );
        expect([...tables].sort()).toEqual(["metrics", "metrics__previous"]);
      });
    }
  );

  it.effect("rebuilds a table that is not WAL without waiting", () => {
    const { ctx, statements } = createFakeContext({
      table: "metrics",
      tables: ["metrics"],
      wal: { metrics__rebuild: settled(1) },
    });

    return Effect.gen(function* () {
      yield* rebuildTable(ctx, shape);

      expect(hasStatement(statements, "RENAME TABLE metrics TO")).toBe(true);
    });
  });
});

describe("recoverTableState", () => {
  const recover = (tablesPresent: readonly string[]) => {
    const fake = createFakeContext({
      table: "metrics",
      tables: tablesPresent,
      wal: {
        metrics: settled(5),
        metrics__rebuild: settled(1),
        metrics__previous: settled(5),
      },
    });
    return { ...fake, run: recoverTableState(fake.ctx, shape) };
  };

  const changes = (statements: readonly string[]) =>
    statements.filter((sql) => /^(DROP|RENAME|CREATE|INSERT)/.test(sql));

  it.effect("leaves a lone table alone", () => {
    const { run, statements, tables } = recover(["metrics"]);

    return Effect.gen(function* () {
      yield* run;

      expect(changes(statements)).toEqual([]);
      expect([...tables]).toEqual(["metrics"]);
    });
  });

  it.effect("leaves a fresh database alone", () => {
    const { run, statements } = recover([]);

    return Effect.gen(function* () {
      yield* run;

      expect(changes(statements)).toEqual([]);
    });
  });

  it.effect("drops a stale copy next to the original", () => {
    const { run, statements, tables } = recover([
      "metrics",
      "metrics__rebuild",
    ]);

    return Effect.gen(function* () {
      yield* run;

      expect(changes(statements)).toEqual([
        "DROP TABLE IF EXISTS metrics__rebuild",
      ]);
      expect([...tables]).toEqual(["metrics"]);
    });
  });

  it.effect(
    "finishes a swap interrupted between the renames: renames the copy in, verifies, drops the original",
    () => {
      const { run, statements, tables } = recover([
        "metrics__rebuild",
        "metrics__previous",
      ]);

      return Effect.gen(function* () {
        yield* run;

        expect(changes(statements)).toEqual([
          "RENAME TABLE metrics__rebuild TO metrics",
          "DROP TABLE metrics__previous",
        ]);
        expect([...tables]).toEqual(["metrics"]);
      });
    }
  );

  it.effect(
    "finishes a swap interrupted before the original was dropped, once the table matches it",
    () => {
      const { run, statements, tables } = recover([
        "metrics",
        "metrics__previous",
      ]);

      return Effect.gen(function* () {
        yield* run;

        expect(changes(statements)).toEqual(["DROP TABLE metrics__previous"]);
        expect([...tables]).toEqual(["metrics"]);
      });
    }
  );

  it.effect("drops nothing when the table does not match the original", () => {
    const { ctx, statements, tables } = createFakeContext({
      table: "metrics",
      tables: ["metrics", "metrics__previous"],
      wal: { metrics: settled(5), metrics__previous: settled(5) },
      digestFor: (table) => (table === "metrics" ? otherDigest : sameDigest),
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(recoverTableState(ctx, shape));

      expect(error.kind).toBe("terminal");
      expect(changes(statements)).toEqual([]);
      expect([...tables].sort()).toEqual(["metrics", "metrics__previous"]);
    });
  });

  it.effect("restores the original when only it is left", () => {
    const { run, statements, tables } = recover(["metrics__previous"]);

    return Effect.gen(function* () {
      yield* run;

      expect(changes(statements)).toEqual([
        "RENAME TABLE metrics__previous TO metrics",
      ]);
      expect([...tables]).toEqual(["metrics"]);
    });
  });

  it.effect("refuses a copy that has no original", () => {
    const { run, statements, tables } = recover(["metrics__rebuild"]);

    return Effect.gen(function* () {
      const error = yield* Effect.flip(run);

      expect(error.kind).toBe("terminal");
      expect(error.message).toContain("metrics__rebuild");
      expect(changes(statements)).toEqual([]);
      expect([...tables]).toEqual(["metrics__rebuild"]);
    });
  });

  it.effect("refuses when all three tables exist, naming them", () => {
    const { run, statements } = recover([
      "metrics",
      "metrics__rebuild",
      "metrics__previous",
    ]);

    return Effect.gen(function* () {
      const error = yield* Effect.flip(run);

      expect(error.kind).toBe("terminal");
      for (const name of ["metrics", "metrics__rebuild", "metrics__previous"]) {
        expect(error.message).toContain(name);
      }
      expect(changes(statements)).toEqual([]);
    });
  });
});

describe("rebuildTable guarantees", () => {
  const walTables = {
    metrics: settled(5),
    metrics__rebuild: settled(1),
  };
  const canonicalNames = NETWORK_METRICS_COLUMNS.map((column) => column.name);
  const withNote = [
    ...canonicalLiveColumns,
    { name: "note", type: "STRING", designated: false },
  ];

  it.effect(
    "digests every canonical column and groups by source and host, on both tables",
    () => {
      const { ctx, statements } = createFakeContext({
        table: "metrics",
        tables: ["metrics"],
        wal: walTables,
      });

      return Effect.gen(function* () {
        yield* rebuildTable(ctx, shape);

        const totals = statements.filter((sql) => sql.includes("AS row_count"));
        const groups = statements.filter((sql) =>
          sql.includes("AS group_count")
        );
        expect(totals[0]).toMatch(/FROM metrics$/);
        expect(totals[1]).toMatch(/FROM metrics__rebuild$/);
        expect(groups[0]).toMatch(/FROM metrics GROUP BY source, host$/);
        expect(groups[1]).toMatch(
          /FROM metrics__rebuild GROUP BY source, host$/
        );
        for (const sql of [totals[0], totals[1]]) {
          for (const name of canonicalNames) {
            expect(sql).toContain(`count(${name}) AS nn_${name}`);
          }
        }
      });
    }
  );

  it.effect(
    "settles the source before creating or copying into the copy",
    () => {
      const reads: number[] = [];
      const { ctx, statements } = createFakeContext({
        table: "metrics",
        tables: ["metrics"],
        wal: {
          ...walTables,
          metrics: (run) => {
            reads.push(run.length);
            return reads.length < 3
              ? { suspended: false, writerTxn: 4, sequencerTxn: 5 }
              : settled(5);
          },
        },
      });

      return Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(rebuildTable(ctx, shape));
        yield* TestClock.adjust(Duration.seconds(5));
        yield* Fiber.join(fiber);

        const create = indexOfStatement(
          statements,
          "CREATE TABLE IF NOT EXISTS metrics__rebuild"
        );
        expect(reads.length).toBeGreaterThanOrEqual(3);
        expect(create).toBeGreaterThanOrEqual(reads[2] ?? Infinity);
        expect(indexOfStatement(statements, "INSERT INTO")).toBeGreaterThan(
          create
        );
      });
    }
  );

  it.effect("waits for the copy to apply before digesting it", () => {
    const reads: number[] = [];
    const { ctx, statements } = createFakeContext({
      table: "metrics",
      tables: ["metrics"],
      wal: {
        ...walTables,
        metrics__rebuild: (run) => {
          reads.push(run.length);
          return reads.length < 3
            ? { suspended: false, writerTxn: 0, sequencerTxn: 1 }
            : settled(1);
        },
      },
    });

    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(rebuildTable(ctx, shape));
      yield* TestClock.adjust(Duration.seconds(5));
      yield* Fiber.join(fiber);

      const digestOfCopy = statements.findIndex(
        (sql) =>
          sql.includes("AS row_count") && sql.endsWith("FROM metrics__rebuild")
      );
      expect(reads.length).toBeGreaterThanOrEqual(3);
      expect(digestOfCopy).toBeGreaterThanOrEqual(reads[2] ?? Infinity);
    });
  });

  it.effect(
    "refuses a source with columns the shape does not know, before swapping",
    () => {
      const { ctx, statements, tables } = createFakeContext({
        table: "metrics",
        tables: ["metrics"],
        wal: walTables,
        columns: { metrics: withNote },
      });

      return Effect.gen(function* () {
        const error = yield* Effect.flip(rebuildTable(ctx, shape));

        expect(error.kind).toBe("terminal");
        expect(error.message).toContain("note");
        expect(hasStatement(statements, "RENAME TABLE")).toBe(false);
        expect([...tables]).toEqual(["metrics"]);
      });
    }
  );

  it.effect("gives up on a copy that does not apply within 30 minutes", () => {
    const { ctx } = createFakeContext({
      table: "metrics",
      tables: ["metrics"],
      wal: {
        ...walTables,
        metrics__rebuild: { suspended: false, writerTxn: 0, sequencerTxn: 1 },
      },
    });

    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(rebuildTable(ctx, shape));
      yield* TestClock.adjust(Duration.minutes(29));
      expect(fiber.pollUnsafe()).toBeUndefined();

      yield* TestClock.adjust(Duration.minutes(2));
      const error = yield* Effect.flip(Fiber.join(fiber));

      expect(error.kind).toBe("transient");
      expect(error.message).toContain("30 minutes");
    });
  });

  it.effect(
    "drops the copy and keeps the original error when the copy statement fails",
    () => {
      const { ctx, statements, tables } = createFakeContext({
        table: "metrics",
        tables: ["metrics"],
        wal: walTables,
        failOn: (sql) =>
          sql.startsWith("INSERT INTO") ? transient("disk full") : undefined,
      });

      return Effect.gen(function* () {
        const error = yield* Effect.flip(rebuildTable(ctx, shape));

        expect(error.kind).toBe("transient");
        expect(error.message).toBe("disk full");
        expect(statements.at(-1)).toBe("DROP TABLE IF EXISTS metrics__rebuild");
        expect([...tables]).toEqual(["metrics"]);
      });
    }
  );
});

describe("recoverTableState verification", () => {
  const settledBoth = {
    metrics: settled(5),
    metrics__previous: settled(5),
  };

  it.effect(
    "refuses a renamed-in copy that differs from the original, dropping nothing",
    () => {
      const { ctx, statements, tables } = createFakeContext({
        table: "metrics",
        tables: ["metrics__rebuild", "metrics__previous"],
        wal: { ...settledBoth, metrics__rebuild: settled(1) },
        digestFor: (table, run) =>
          table === "metrics" && run.some((sql) => sql.startsWith("RENAME"))
            ? otherDigest
            : sameDigest,
      });

      return Effect.gen(function* () {
        const error = yield* Effect.flip(recoverTableState(ctx, shape));

        expect(error.kind).toBe("terminal");
        expect(hasStatement(statements, "DROP TABLE")).toBe(false);
        expect([...tables].sort()).toEqual(["metrics", "metrics__previous"]);
      });
    }
  );

  it.effect(
    "refuses to drop an original that has columns the shape does not know",
    () => {
      const { ctx, statements, tables } = createFakeContext({
        table: "metrics",
        tables: ["metrics", "metrics__previous"],
        wal: settledBoth,
        columns: {
          metrics__previous: [
            ...canonicalLiveColumns,
            { name: "note", type: "STRING", designated: false },
          ],
        },
      });

      return Effect.gen(function* () {
        const error = yield* Effect.flip(recoverTableState(ctx, shape));

        expect(error.kind).toBe("terminal");
        expect(error.message).toContain("note");
        expect(hasStatement(statements, "DROP TABLE")).toBe(false);
        expect([...tables].sort()).toEqual(["metrics", "metrics__previous"]);
      });
    }
  );
});

describe("recoverTableState finishing a swap", () => {
  const settledBoth = {
    metrics: settled(5),
    metrics__previous: settled(5),
  };
  const digestIndex = (statements: readonly string[], table: string) =>
    statements.findIndex(
      (sql) => sql.includes("AS row_count") && sql.endsWith(`FROM ${table}`)
    );

  it.effect(
    "digests the table only after it settles, and drops the original last",
    () => {
      const reads: number[] = [];
      const { ctx, statements } = createFakeContext({
        table: "metrics",
        tables: ["metrics", "metrics__previous"],
        wal: {
          ...settledBoth,
          metrics: (run) => {
            reads.push(run.length);
            return reads.length < 3
              ? { suspended: false, writerTxn: 4, sequencerTxn: 5 }
              : settled(5);
          },
        },
      });

      return Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(recoverTableState(ctx, shape));
        yield* TestClock.adjust(Duration.seconds(5));
        yield* Fiber.join(fiber);

        expect(reads).toHaveLength(3);
        expect(digestIndex(statements, "metrics")).toBeGreaterThanOrEqual(
          reads[2] ?? Infinity
        );
        expect(statements.at(-1)).toBe("DROP TABLE metrics__previous");
      });
    }
  );

  it.effect("digests the original only after its own WAL settles", () => {
    const reads: number[] = [];
    const { ctx, statements } = createFakeContext({
      table: "metrics",
      tables: ["metrics", "metrics__previous"],
      wal: {
        ...settledBoth,
        metrics__previous: (run) => {
          reads.push(run.length);
          return reads.length < 3
            ? { suspended: false, writerTxn: 4, sequencerTxn: 5 }
            : settled(5);
        },
      },
    });

    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(recoverTableState(ctx, shape));
      yield* TestClock.adjust(Duration.seconds(5));
      yield* Fiber.join(fiber);

      expect(reads.length).toBeGreaterThanOrEqual(3);
      expect(
        digestIndex(statements, "metrics__previous")
      ).toBeGreaterThanOrEqual(reads[2] ?? Infinity);
      expect(statements.at(-1)).toBe("DROP TABLE metrics__previous");
    });
  });

  it.effect(
    "keeps the original and says what to do when it took a write during the check",
    () => {
      let reads = 0;
      const { ctx, statements, tables } = createFakeContext({
        table: "metrics",
        tables: ["metrics", "metrics__previous"],
        wal: {
          ...settledBoth,
          metrics__previous: () => {
            reads += 1;
            return settled(reads === 1 ? 5 : 6);
          },
        },
      });

      return Effect.gen(function* () {
        const error = yield* Effect.flip(recoverTableState(ctx, shape));

        expect(error.kind).toBe("terminal");
        expect(error.message).toContain("metrics__previous");
        expect(error.message).toContain(
          "any rows of metrics__previous that metrics lacks"
        );
        expect(error.message).toContain(
          "drops metrics__previous once they match"
        );
        expect(hasStatement(statements, "DROP TABLE")).toBe(false);
        expect([...tables].sort()).toEqual(["metrics", "metrics__previous"]);
      });
    }
  );
});

describe("recoverTableState in a process that has opened an ILP connection", () => {
  const recoverWithoutRewrite = (tablesPresent: readonly string[]) => {
    const fake = createFakeContext({
      table: "metrics",
      tables: tablesPresent,
      canRewriteTables: false,
      wal: {
        metrics: settled(5),
        metrics__rebuild: settled(1),
        metrics__previous: settled(5),
      },
    });
    return { ...fake, run: recoverTableState(fake.ctx, shape) };
  };

  const changes = (statements: readonly string[]) =>
    statements.filter((sql) => /^(DROP|RENAME|CREATE|INSERT)/.test(sql));

  const needingRewrite: [string, string[]][] = [
    ["-RP", ["metrics__rebuild", "metrics__previous"]],
    ["T-P", ["metrics", "metrics__previous"]],
    ["--P", ["metrics__previous"]],
  ];

  it.effect.each(needingRewrite)(
    "asks for a restart in state %s and changes nothing",
    ([, present]) => {
      const { run, statements, tables } = recoverWithoutRewrite(present);

      return Effect.gen(function* () {
        const error = yield* Effect.flip(run);

        expect(error.kind).toBe("terminal");
        expect(error.step).toBe("recovery");
        expect(error.message).toContain("ILP connection");
        expect(error.message).toContain("Restart the server");
        expect(changes(statements)).toEqual([]);
        expect([...tables].sort()).toEqual([...present].sort());
      });
    }
  );

  const idle: [string, string[]][] = [
    ["---", []],
    ["T--", ["metrics"]],
  ];

  it.effect.each(idle)("leaves state %s alone", ([, present]) => {
    const { run, statements } = recoverWithoutRewrite(present);

    return Effect.gen(function* () {
      yield* run;

      expect(changes(statements)).toEqual([]);
    });
  });

  it.effect("still drops a stale copy next to the original", () => {
    const { run, statements, tables } = recoverWithoutRewrite([
      "metrics",
      "metrics__rebuild",
    ]);

    return Effect.gen(function* () {
      yield* run;

      expect(changes(statements)).toEqual([
        "DROP TABLE IF EXISTS metrics__rebuild",
      ]);
      expect([...tables]).toEqual(["metrics"]);
    });
  });

  it.effect.each<[string, string[], string]>([
    ["-R-", ["metrics__rebuild"], "metrics__rebuild exists"],
    ["TRP", ["metrics", "metrics__rebuild", "metrics__previous"], "all exist"],
  ])("still refuses state %s with its own message", ([, present, text]) => {
    const { run } = recoverWithoutRewrite(present);

    return Effect.gen(function* () {
      const error = yield* Effect.flip(run);

      expect(error.kind).toBe("terminal");
      expect(error.message).toContain(text);
      expect(error.message).not.toContain("Restart the server");
    });
  });
});

describe("recoverTableState progress", () => {
  const announcing = (tablesPresent: readonly string[]) => {
    const fake = createFakeContext({
      table: "metrics",
      tables: tablesPresent,
      wal: {
        metrics: settled(5),
        metrics__rebuild: settled(1),
        metrics__previous: settled(5),
      },
    });
    const steps: string[] = [];
    const run = recoverTableState(fake.ctx, shape, (step) =>
      Effect.sync(() => void steps.push(step))
    );
    return { ...fake, steps, run };
  };

  it.effect.each<[string, string[]]>([
    ["TR-", ["metrics", "metrics__rebuild"]],
    ["-RP", ["metrics__rebuild", "metrics__previous"]],
    ["T-P", ["metrics", "metrics__previous"]],
    ["--P", ["metrics__previous"]],
  ])("announces the recovery in state %s", ([, present]) => {
    const { run, steps } = announcing(present);

    return Effect.gen(function* () {
      yield* run;

      expect(steps).toEqual(["recovering an interrupted rebuild of metrics"]);
    });
  });

  it.effect("announces the recovery before it changes anything", () => {
    const fake = createFakeContext({
      table: "metrics",
      tables: ["metrics", "metrics__rebuild"],
    });
    const changesAtAnnouncement: number[] = [];

    return Effect.gen(function* () {
      yield* recoverTableState(fake.ctx, shape, () =>
        Effect.sync(
          () =>
            void changesAtAnnouncement.push(
              fake.statements.filter((sql) => /^(DROP|RENAME)/.test(sql)).length
            )
        )
      );

      expect(changesAtAnnouncement).toEqual([0]);
      expect(fake.statements).toContain(
        "DROP TABLE IF EXISTS metrics__rebuild"
      );
    });
  });

  it.effect.each<[string, string[]]>([
    ["---", []],
    ["T--", ["metrics"]],
  ])("announces nothing in state %s", ([, present]) => {
    const { run, steps } = announcing(present);

    return Effect.gen(function* () {
      yield* run;

      expect(steps).toEqual([]);
    });
  });
});
