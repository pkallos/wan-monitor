import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { withLedgerLossGuard } from "@/infrastructure/database/questdb/migrations/ledger-loss-guard";
import type { Migration } from "@/infrastructure/database/questdb/migrations/migration";
import { conformNetworkMetrics } from "@/infrastructure/database/questdb/migrations/v2-conform-network-metrics";
import { addPingDuration } from "@/infrastructure/database/questdb/migrations/v4-add-ping-duration";
import {
  backticked,
  canonicalLiveColumns,
  createFakeContext,
  v2LiveColumns,
} from "@/infrastructure/database/questdb/test-utils/fake-migration-context";

const inner: Migration = {
  version: 2,
  name: "inner",
  up: (ctx) => Effect.asVoid(ctx.query("-- inner up")),
};

const setup = (
  columns: typeof canonicalLiveColumns,
  migration: Migration = inner,
  newest: () => Migration = () => addPingDuration
) => {
  const fake = createFakeContext({
    table: "metrics",
    tables: ["metrics"],
    columns: { metrics: columns },
  });
  return { ...fake, guarded: withLedgerLossGuard(migration, newest) };
};

const changes = (statements: readonly string[]) =>
  statements.filter((sql) => /^(CREATE|INSERT|RENAME|DROP|ALTER)/.test(sql));

describe("withLedgerLossGuard", () => {
  it("keeps the wrapped migration's version and name", () => {
    const { guarded } = setup(v2LiveColumns, conformNetworkMetrics);

    expect(guarded.version).toBe(2);
    expect(guarded.name).toBe("conform-network-metrics");
  });

  it.effect(
    "runs the wrapped migration on a table of exactly v2's columns",
    () => {
      const { guarded, ctx, statements } = setup(v2LiveColumns);

      return Effect.gen(function* () {
        yield* guarded.up(ctx);

        expect(statements).toContain("-- inner up");
      });
    }
  );

  it.effect(
    "refuses a table that has a later migration's column and runs nothing",
    () => {
      const { guarded, ctx, statements } = setup(canonicalLiveColumns);

      return Effect.gen(function* () {
        const error = yield* Effect.flip(guarded.up(ctx));

        expect(error.kind).toBe("terminal");
        expect(error.sticky).toBeUndefined();
        expect(error.message).toContain("metrics already has duration_ms");
        expect(error.message).toContain("metrics_migrations");
        expect(error.message).toContain("has not been changed");
        expect(error.message).not.toContain("drop them yourself");
        expect(backticked(error.message)).toEqual([
          "INSERT INTO metrics_migrations VALUES (4, 'add-ping-duration', now())",
        ]);
        expect(statements).not.toContain("-- inner up");
        expect(changes(statements)).toEqual([]);
      });
    }
  );

  it.effect("names the newest migration it is given", () => {
    const newest: Migration = {
      version: 7,
      name: "later",
      up: () => Effect.void,
    };
    const { guarded, ctx } = setup(canonicalLiveColumns, inner, () => newest);

    return Effect.gen(function* () {
      const error = yield* Effect.flip(guarded.up(ctx));

      expect(backticked(error.message)).toEqual([
        "INSERT INTO metrics_migrations VALUES (7, 'later', now())",
      ]);
    });
  });

  it.effect("looks up the newest migration only when it refuses", () => {
    let lookups = 0;
    const newest = () => {
      lookups += 1;
      return addPingDuration;
    };
    const clean = setup(v2LiveColumns, inner, newest);
    const lost = setup(canonicalLiveColumns, inner, newest);

    return Effect.gen(function* () {
      yield* clean.guarded.up(clean.ctx);
      expect(lookups).toBe(0);

      yield* Effect.flip(lost.guarded.up(lost.ctx));
      expect(lookups).toBe(1);
    });
  });

  it.effect(
    "leaves a column outside every list to the wrapped migration's own refusal",
    () => {
      const { guarded, ctx, statements } = setup(
        [...v2LiveColumns, { name: "note", type: "STRING", designated: false }],
        conformNetworkMetrics
      );

      return Effect.gen(function* () {
        const error = yield* Effect.flip(guarded.up(ctx));

        expect(error.message).toContain("drop them yourself");
        expect(error.message).toContain("note");
        expect(changes(statements)).toEqual([]);
      });
    }
  );

  it.effect(
    "refuses on the later column even when an unknown one is also present",
    () => {
      const { guarded, ctx } = setup(
        [
          ...canonicalLiveColumns,
          { name: "note", type: "STRING", designated: false },
        ],
        conformNetworkMetrics
      );

      return Effect.gen(function* () {
        const error = yield* Effect.flip(guarded.up(ctx));

        expect(error.message).toContain("metrics already has duration_ms");
        expect(error.message).not.toContain("drop them yourself");
      });
    }
  );

  it.effect(
    "lets the wrapped migration rebuild a table whose v2 columns drifted",
    () => {
      const { guarded, ctx, statements } = setup(
        v2LiveColumns.map((column) =>
          column.name === "isp" ? { ...column, type: "VARCHAR" } : column
        )
      );

      return Effect.gen(function* () {
        yield* guarded.up(ctx);

        expect(statements).toContain("-- inner up");
      });
    }
  );
});
