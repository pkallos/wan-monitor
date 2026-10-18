import { Effect } from "effect";
import {
  digestMismatches,
  type TableDigest,
} from "@/infrastructure/database/questdb/migrations/digest";
import {
  awaitApplied,
  readDigest,
} from "@/infrastructure/database/questdb/migrations/introspect";
import {
  type Migration,
  type MigrationContext,
  type MigrationError,
  stickyError,
} from "@/infrastructure/database/questdb/migrations/migration";
import {
  NETWORK_METRICS_GROUP_COLUMNS,
  NETWORK_METRICS_V2_COLUMNS,
} from "@/infrastructure/database/questdb/migrations/v2-conform-network-metrics";

/**
 * Speed columns older writers filled with 0 when the speed test reported no
 * reading. Frozen: later changes are new migrations.
 */
export const ZERO_FILLED_SPEEDTEST_COLUMNS = [
  "download_bandwidth",
  "upload_bandwidth",
] as const;

type SpeedColumn = (typeof ZERO_FILLED_SPEEDTEST_COLUMNS)[number];

const zeroPredicate = (column: SpeedColumn): string =>
  `source = 'speedtest' AND ${column} = 0`;

const countZeros = (
  ctx: MigrationContext,
  column: SpeedColumn
): Effect.Effect<number, MigrationError> =>
  ctx
    .query(
      `SELECT count() AS zeros FROM ${ctx.table} WHERE ${zeroPredicate(column)}`
    )
    .pipe(Effect.map((rows) => Number(rows[0]?.zeros ?? 0)));

/** The digest once `emptied` zeros are NULL: those columns' non-null counts drop, and a sum with nothing left is NULL. */
const expectedAfter = (
  before: TableDigest,
  emptied: ReadonlyMap<SpeedColumn, number>
): TableDigest => ({
  ...before,
  totals: {
    ...before.totals,
    ...Object.fromEntries(
      [...emptied].flatMap(([column, zeros]) => {
        const remaining = Number(before.totals[`nn_${column}`]) - zeros;
        return remaining === 0
          ? [
              [`nn_${column}`, remaining],
              [`sum_${column}`, null],
            ]
          : [[`nn_${column}`, remaining]];
      })
    ),
  },
});

const digestOf = (ctx: MigrationContext) =>
  readDigest(
    ctx,
    ctx.table,
    NETWORK_METRICS_V2_COLUMNS,
    NETWORK_METRICS_GROUP_COLUMNS
  );

/**
 * Empties the 0 that older versions stored for a speed test with no reading (a
 * real reading is at least 8 bps). An in-place UPDATE can't be proven
 * beforehand, so the before and after digests may differ only by the emptied
 * values; a failure is recorded in the ledger and survives a retry.
 */
export const nullZeroSpeedtestSpeeds: Migration = {
  version: 3,
  name: "null-zero-speedtest-speeds",
  up: (ctx) =>
    Effect.gen(function* () {
      yield* awaitApplied(ctx, ctx.table);

      const counts = new Map<SpeedColumn, number>();
      for (const column of ZERO_FILLED_SPEEDTEST_COLUMNS) {
        const zeros = yield* countZeros(ctx, column);
        if (zeros > 0) counts.set(column, zeros);
      }
      if (counts.size === 0) {
        yield* Effect.logInfo(
          `QuestDB migration: no speed test speeds stored as 0 in ${ctx.table}`
        );
        return;
      }

      const before = yield* digestOf(ctx);
      for (const column of counts.keys()) {
        yield* ctx.query(
          `UPDATE ${ctx.table} SET ${column} = NULL WHERE ${zeroPredicate(column)}`
        );
      }
      yield* awaitApplied(ctx, ctx.table);

      const mismatches = digestMismatches(
        expectedAfter(before, counts),
        yield* digestOf(ctx),
        ["expectation", "table"]
      );
      if (mismatches.length > 0) {
        return yield* Effect.fail(
          stickyError(
            "verify",
            `Emptying the stored zeros changed ${ctx.table} in other ways (${mismatches.slice(0, 5).join("; ")}). Restore the QuestDB volume from the snapshot taken before upgrading, then restart.`
          )
        );
      }

      yield* Effect.logInfo(
        `QuestDB migration: emptied ${[...counts]
          .map(([column, zeros]) => `${zeros} ${column}`)
          .join(" and ")} stored as 0 on speed test rows in ${ctx.table}`
      );
    }),
};
