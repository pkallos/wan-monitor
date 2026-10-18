import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import {
  createNetworkMetrics,
  isDuplicateColumnError,
  NETWORK_METRICS_V1_COLUMNS,
} from "@/infrastructure/database/questdb/migrations/v1-create-network-metrics";
import {
  canonicalLiveColumns,
  createFakeContext,
  transient,
} from "@/infrastructure/database/questdb/test-utils/fake-migration-context";

const allNames = NETWORK_METRICS_V1_COLUMNS.map((column) => column.name);

const withoutColumns = (...names: string[]) =>
  canonicalLiveColumns.filter((column) => !names.includes(column.name));

const alters = (statements: readonly string[]) =>
  statements.filter((sql) => sql.startsWith("ALTER TABLE"));

describe("create-network-metrics", () => {
  it("is version 1", () => {
    expect(createNetworkMetrics.version).toBe(1);
  });

  it.effect("creates the table before looking at its columns", () => {
    const { ctx, statements } = createFakeContext({ table: "metrics" });

    return Effect.gen(function* () {
      yield* createNetworkMetrics.up(ctx);

      const create = statements.findIndex((sql) =>
        sql.startsWith("CREATE TABLE IF NOT EXISTS metrics")
      );
      const introspect = statements.findIndex((sql) =>
        sql.includes("table_columns('metrics')")
      );
      expect(create).toBeGreaterThanOrEqual(0);
      expect(introspect).toBeGreaterThan(create);
      expect(statements[create]).toContain("PARTITION BY DAY WAL");
    });
  });

  it.effect("adds nothing when every column exists", () => {
    const { ctx, statements } = createFakeContext({ table: "metrics" });

    return Effect.gen(function* () {
      yield* createNetworkMetrics.up(ctx);

      expect(alters(statements)).toEqual([]);
    });
  });

  it.effect("adds exactly the missing columns, on the configured table", () => {
    const { ctx, statements } = createFakeContext({
      table: "metrics_test_2",
      columns: {
        metrics_test_2: withoutColumns("external_ip", "internal_ip"),
      },
    });

    return Effect.gen(function* () {
      yield* createNetworkMetrics.up(ctx);

      expect(alters(statements)).toEqual([
        "ALTER TABLE metrics_test_2 ADD COLUMN external_ip STRING;",
        "ALTER TABLE metrics_test_2 ADD COLUMN internal_ip STRING;",
      ]);
    });
  });

  it.effect(
    "waits for the added columns to be applied before finishing",
    () => {
      const reads: number[] = [];
      const { ctx, statements } = createFakeContext({
        table: "metrics",
        columns: { metrics: withoutColumns("isp", "internal_ip") },
        wal: {
          metrics: (run) => {
            reads.push(run.length);
            return reads.length < 3
              ? { suspended: false, writerTxn: 4, sequencerTxn: 6 }
              : { suspended: false, writerTxn: 6, sequencerTxn: 6 };
          },
        },
      });

      return Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(createNetworkMetrics.up(ctx));
        yield* TestClock.adjust(Duration.seconds(5));
        yield* Fiber.join(fiber);

        const lastAlter = statements.reduce(
          (last, sql, index) => (sql.startsWith("ALTER TABLE") ? index : last),
          -1
        );
        expect(reads).toHaveLength(3);
        expect(Math.min(...reads)).toBeGreaterThan(lastAlter);
      });
    }
  );

  it.effect("treats a concurrent duplicate-column error as success", () => {
    const { ctx } = createFakeContext({
      table: "metrics",
      columns: { metrics: withoutColumns("isp") },
      failOn: (sql) =>
        sql.includes("ADD COLUMN isp")
          ? transient("column already exists [name=isp]")
          : undefined,
    });

    return Effect.gen(function* () {
      const exit = yield* Effect.exit(createNetworkMetrics.up(ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });

  it.effect("treats a 'Duplicate column' variant as success", () => {
    const { ctx } = createFakeContext({
      table: "metrics",
      columns: { metrics: withoutColumns("isp") },
      failOn: (sql) =>
        sql.includes("ADD COLUMN isp")
          ? transient("Duplicate column [name=isp]")
          : undefined,
    });

    return Effect.gen(function* () {
      const exit = yield* Effect.exit(createNetworkMetrics.up(ctx));

      expect(Exit.isSuccess(exit)).toBe(true);
    });
  });

  it.effect("fails when an ALTER raises a real error", () => {
    const { ctx } = createFakeContext({
      table: "metrics",
      columns: { metrics: withoutColumns("isp") },
      failOn: (sql) =>
        sql.includes("ADD COLUMN isp")
          ? transient("table lock timeout")
          : undefined,
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(createNetworkMetrics.up(ctx));

      expect(error.message).toContain("table lock timeout");
    });
  });

  it.effect("fails when creating the table fails", () => {
    const { ctx } = createFakeContext({
      table: "metrics",
      failOn: (sql) =>
        sql.startsWith("CREATE TABLE") ? transient("boom") : undefined,
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(createNetworkMetrics.up(ctx));

      expect(error.message).toBe("boom");
    });
  });

  it.effect("fails when introspecting the columns fails", () => {
    const { ctx } = createFakeContext({
      table: "metrics",
      failOn: (sql) =>
        sql.includes("table_columns")
          ? transient("connection reset")
          : undefined,
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(createNetworkMetrics.up(ctx));

      expect(error.message).toBe("connection reset");
    });
  });

  it("declares the original thirteen columns", () => {
    expect(allNames).toEqual([
      "timestamp",
      "source",
      "host",
      "latency",
      "jitter",
      "packet_loss",
      "connectivity_status",
      "download_bandwidth",
      "upload_bandwidth",
      "server_location",
      "isp",
      "external_ip",
      "internal_ip",
    ]);
  });
});

describe("isDuplicateColumnError", () => {
  it("recognizes both wordings", () => {
    expect(isDuplicateColumnError("column already exists [name=isp]")).toBe(
      true
    );
    expect(isDuplicateColumnError("Duplicate column [name=isp]")).toBe(true);
  });

  it("rejects other errors", () => {
    expect(isDuplicateColumnError("table lock timeout")).toBe(false);
  });
});
