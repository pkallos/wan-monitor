import { NETWORK_METRICS_COLUMNS } from "@wan-monitor/shared/db-schema";
import { Effect } from "effect";
import { listColumns } from "@/infrastructure/database/questdb/migrations/introspect";
import {
  acceptAsAppliedSql,
  ledgerName,
} from "@/infrastructure/database/questdb/migrations/ledger";
import {
  type Migration,
  terminalError,
} from "@/infrastructure/database/questdb/migrations/migration";
import { NETWORK_METRICS_V2_COLUMNS } from "@/infrastructure/database/questdb/migrations/v2-conform-network-metrics";

const V2_NAMES: ReadonlySet<string> = new Set(
  NETWORK_METRICS_V2_COLUMNS.map((column) => column.name)
);

const CURRENT_NAMES: ReadonlySet<string> = new Set(
  NETWORK_METRICS_COLUMNS.map((column) => column.name)
);

/**
 * Wraps the migration that rewrites or refuses a table of unknown shape. If the
 * table already holds a column a later migration added, the ledger lost the
 * record of that migration, and running `migration` would ask the operator to
 * drop measured data. The guard refuses instead and puts the statement that
 * accepts the table as it is in the error. `newest` is called only on refusal.
 * The error names the newest migration, which is correct while every migration
 * after v2 adds columns `verifySchema` checks or is safe to skip.
 */
export const withLedgerLossGuard = (
  migration: Migration,
  newest: () => Migration
): Migration => ({
  version: migration.version,
  name: migration.name,
  up: (ctx) =>
    Effect.gen(function* () {
      const later = (yield* listColumns(ctx, ctx.table))
        .map((column) => column.name)
        .filter((name) => !V2_NAMES.has(name) && CURRENT_NAMES.has(name));
      if (later.length > 0) {
        const ledger = ledgerName(ctx.table);
        return yield* Effect.fail(
          terminalError(
            "ledger-loss",
            `${ctx.table} already has ${later.join(", ")}, which a later migration added, but ${ledger} records no such migration, so the ledger lost that record. ${ctx.table} has not been changed. To continue, record the schema as applied with \`${acceptAsAppliedSql(ledger, newest())}\`. The server continues on its next retry or restart.`
          )
        );
      }
      return yield* migration.up(ctx);
    }),
});
