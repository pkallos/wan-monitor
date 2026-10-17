import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { conformNetworkMetrics } from "@/infrastructure/database/questdb/migrations/v2-conform-network-metrics";
import {
  canonicalLiveColumns,
  createFakeContext,
} from "@/infrastructure/database/questdb/test-utils/fake-migration-context";

const retyped = (name: string, type: string) =>
  canonicalLiveColumns.map((column) =>
    column.name === name ? { ...column, type } : column
  );

const changes = (statements: readonly string[]) =>
  statements.filter((sql) => /^(CREATE|INSERT|RENAME|DROP)/.test(sql));

const run = (
  columns: Parameters<typeof createFakeContext>[0]["columns"],
  canRewriteTables = true
) => {
  const fake = createFakeContext({
    table: "metrics",
    tables: ["metrics"],
    columns,
    canRewriteTables,
  });
  return { ...fake, up: conformNetworkMetrics.up(fake.ctx) };
};

describe("conform-network-metrics", () => {
  it("is version 2", () => {
    expect(conformNetworkMetrics.version).toBe(2);
  });

  it.effect("leaves a conforming table alone", () => {
    const { up, statements } = run({ metrics: canonicalLiveColumns });

    return Effect.gen(function* () {
      yield* up;

      expect(changes(statements)).toEqual([]);
    });
  });

  it.effect("leaves a table with a missing column alone", () => {
    const { up, statements } = run({
      metrics: canonicalLiveColumns.filter((column) => column.name !== "isp"),
    });

    return Effect.gen(function* () {
      yield* up;

      expect(changes(statements)).toEqual([]);
    });
  });

  it.effect.each([
    ["a nanosecond designated timestamp", "timestamp", "TIMESTAMP_NS"],
    ["VARCHAR strings", "isp", "VARCHAR"],
    ["SYMBOL strings", "connectivity_status", "SYMBOL"],
  ])("rebuilds a table with %s", ([, name, type]) => {
    const { up, statements } = run({ metrics: retyped(name, type) });

    return Effect.gen(function* () {
      yield* up;

      expect(
        statements.some((sql) => sql.startsWith("INSERT INTO metrics__rebuild"))
      ).toBe(true);
      expect(statements).toContain("RENAME TABLE metrics__rebuild TO metrics");
    });
  });

  it.effect("refuses a table with a column the schema does not have", () => {
    const { up, statements } = run({
      metrics: [
        ...canonicalLiveColumns,
        { name: "note", type: "STRING", designated: false },
      ],
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(up);

      expect(error.kind).toBe("terminal");
      expect(error.message).toContain("note");
      expect(changes(statements)).toEqual([]);
    });
  });

  describe("in a process that has opened an ILP connection", () => {
    it.effect("asks for a restart instead of rebuilding", () => {
      const { up, statements } = run(
        { metrics: retyped("isp", "VARCHAR") },
        false
      );

      return Effect.gen(function* () {
        const error = yield* Effect.flip(up);

        expect(error.kind).toBe("terminal");
        expect(error.step).toBe("conform");
        expect(error.message).toContain("metrics");
        expect(error.message).toContain("ILP connection");
        expect(error.message).toContain("Restart the server");
        expect(changes(statements)).toEqual([]);
      });
    });

    it.effect("still leaves a conforming table alone", () => {
      const { up, statements } = run({ metrics: canonicalLiveColumns }, false);

      return Effect.gen(function* () {
        yield* up;

        expect(changes(statements)).toEqual([]);
      });
    });

    it.effect("still refuses a column the schema does not have", () => {
      const { up } = run(
        {
          metrics: [
            ...canonicalLiveColumns,
            { name: "note", type: "STRING", designated: false },
          ],
        },
        false
      );

      return Effect.gen(function* () {
        const error = yield* Effect.flip(up);

        expect(error.message).toContain("note");
        expect(error.message).not.toContain("Restart the server");
      });
    });
  });
});
