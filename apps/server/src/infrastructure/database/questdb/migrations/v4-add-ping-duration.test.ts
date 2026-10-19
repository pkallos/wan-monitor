import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import {
  addPingDuration,
  PING_DURATION_COLUMN,
} from "@/infrastructure/database/questdb/migrations/v4-add-ping-duration";
import {
  canonicalLiveColumns,
  createFakeContext,
  terminal,
  transient,
  v2LiveColumns,
} from "@/infrastructure/database/questdb/test-utils/fake-migration-context";

const alters = (statements: readonly string[]) =>
  statements.filter((sql) => sql.startsWith("ALTER TABLE"));

describe("add-ping-duration", () => {
  it("is version 4 and adds a DOUBLE duration_ms", () => {
    expect(addPingDuration.version).toBe(4);
    expect(addPingDuration.name).toBe("add-ping-duration");
    expect(PING_DURATION_COLUMN).toEqual({
      name: "duration_ms",
      type: "DOUBLE",
    });
  });

  it.effect("adds the column to a table that lacks it", () => {
    const { ctx, statements } = createFakeContext({
      table: "metrics_test_4",
      columns: { metrics_test_4: v2LiveColumns },
    });

    return Effect.gen(function* () {
      yield* addPingDuration.up(ctx);

      expect(alters(statements)).toEqual([
        "ALTER TABLE metrics_test_4 ADD COLUMN duration_ms DOUBLE;",
      ]);
    });
  });

  it.effect("does nothing when the column exists", () => {
    const { ctx, statements } = createFakeContext({
      table: "metrics",
      columns: { metrics: canonicalLiveColumns },
    });

    return Effect.gen(function* () {
      yield* addPingDuration.up(ctx);

      expect(alters(statements)).toEqual([]);
    });
  });

  it.effect("waits for the added column to be applied", () => {
    const { ctx, statements } = createFakeContext({
      table: "metrics",
      columns: { metrics: v2LiveColumns },
      wal: {
        metrics: (run) => ({
          suspended: false,
          writerTxn:
            run.filter((sql) => sql.includes("FROM wal_tables()")).length >= 3
              ? 2
              : 1,
          sequencerTxn: 2,
        }),
      },
    });

    return Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(addPingDuration.up(ctx));
      yield* TestClock.adjust(Duration.seconds(5));
      yield* Fiber.join(fiber);

      const alter = statements.findIndex((sql) =>
        sql.startsWith("ALTER TABLE")
      );
      const statusQueries = statements.flatMap((sql, index) =>
        sql.includes("FROM wal_tables()") ? [index] : []
      );
      expect(alter).toBeGreaterThanOrEqual(0);
      expect(statusQueries.length).toBeGreaterThanOrEqual(3);
      expect(statusQueries.every((index) => index > alter)).toBe(true);
    });
  });

  it.effect("treats a concurrent duplicate-column error as success", () => {
    const { ctx } = createFakeContext({
      table: "metrics",
      columns: { metrics: v2LiveColumns },
      failOn: (sql) =>
        sql.includes("ADD COLUMN duration_ms")
          ? transient("column already exists [name=duration_ms]")
          : undefined,
    });

    return Effect.gen(function* () {
      const exit = yield* Effect.exit(addPingDuration.up(ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });

  it.effect("fails with a transient error and records nothing", () => {
    const { ctx, statements, ledger, failures } = createFakeContext({
      table: "metrics",
      columns: { metrics: v2LiveColumns },
      failOn: (sql) =>
        sql.includes("ADD COLUMN duration_ms")
          ? transient("connection reset")
          : undefined,
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(addPingDuration.up(ctx));

      expect(error.kind).toBe("transient");
      expect(error.sticky).toBeUndefined();
      expect(statements.some((sql) => sql.startsWith("INSERT INTO"))).toBe(
        false
      );
      expect(ledger).toEqual([]);
      expect(failures.size).toBe(0);
    });
  });

  it.effect(
    "surfaces a suspended table as a terminal, non-sticky error",
    () => {
      const { ctx, failures } = createFakeContext({
        table: "metrics",
        columns: { metrics: v2LiveColumns },
        wal: { metrics: { suspended: true, writerTxn: 1, sequencerTxn: 2 } },
      });

      return Effect.gen(function* () {
        const error = yield* Effect.flip(addPingDuration.up(ctx));

        expect(error.kind).toBe("terminal");
        expect(error.sticky).toBeUndefined();
        expect(failures.size).toBe(0);
      });
    }
  );

  it.effect("fails on an ALTER error that is not a duplicate", () => {
    const { ctx } = createFakeContext({
      table: "metrics",
      columns: { metrics: v2LiveColumns },
      failOn: (sql) =>
        sql.includes("ADD COLUMN duration_ms")
          ? terminal("table is read only")
          : undefined,
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(addPingDuration.up(ctx));

      expect(error.message).toContain("read only");
    });
  });
});
