import type { ColumnDefinition } from "@wan-monitor/shared/db-schema";
import { Effect } from "effect";
import { listColumns } from "@/infrastructure/database/questdb/migrations/introspect";
import {
  type Migration,
  terminalError,
} from "@/infrastructure/database/questdb/migrations/migration";
import {
  rebuildTable,
  requireRewriteAllowed,
} from "@/infrastructure/database/questdb/migrations/rebuild";
import {
  needsRebuild,
  schemaDrift,
  type TableShape,
} from "@/infrastructure/database/questdb/migrations/schema";

/** The columns and types the table must have after this migration. Frozen: later changes are new migrations. */
export const NETWORK_METRICS_V2_COLUMNS: readonly ColumnDefinition[] = [
  { name: "timestamp", type: "TIMESTAMP" },
  { name: "source", type: "SYMBOL" },
  { name: "host", type: "SYMBOL" },
  { name: "latency", type: "DOUBLE" },
  { name: "jitter", type: "DOUBLE" },
  { name: "packet_loss", type: "DOUBLE" },
  { name: "connectivity_status", type: "STRING" },
  { name: "download_bandwidth", type: "LONG" },
  { name: "upload_bandwidth", type: "LONG" },
  { name: "server_location", type: "STRING" },
  { name: "isp", type: "STRING" },
  { name: "external_ip", type: "STRING" },
  { name: "internal_ip", type: "STRING" },
];

export const NETWORK_METRICS_GROUP_COLUMNS = ["source", "host"] as const;

const shape: TableShape = {
  columns: NETWORK_METRICS_V2_COLUMNS,
  groupColumns: NETWORK_METRICS_GROUP_COLUMNS,
};

/**
 * Rewrites a table whose column types or designated timestamp drifted, since
 * QuestDB cannot retype a designated timestamp in place.
 */
export const conformNetworkMetrics: Migration = {
  version: 2,
  name: "conform-network-metrics",
  up: (ctx) =>
    Effect.gen(function* () {
      const drift = schemaDrift(
        yield* listColumns(ctx, ctx.table),
        NETWORK_METRICS_V2_COLUMNS
      );
      if (drift.extra.length > 0) {
        return yield* Effect.fail(
          terminalError(
            "conform",
            `${ctx.table} has columns this build does not know (${drift.extra.join(", ")}). They are never dropped automatically: drop them yourself once their data is no longer needed, then restart.`
          )
        );
      }
      if (!needsRebuild(drift)) {
        yield* Effect.logInfo(
          `QuestDB schema migration: ${ctx.table} already conforms`
        );
        return;
      }
      yield* requireRewriteAllowed(ctx, "conform", `Rebuilding ${ctx.table}`);
      yield* rebuildTable(ctx, shape);
    }),
};
