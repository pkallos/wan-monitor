import {
  buildAddColumnSql,
  buildCreateTableSql,
  type ColumnDefinition,
  missingColumns,
} from "@wan-monitor/shared/db-schema";
import { Effect } from "effect";
import {
  awaitApplied,
  listColumns,
} from "@/infrastructure/database/questdb/migrations/introspect";
import type {
  Migration,
  MigrationContext,
  MigrationError,
} from "@/infrastructure/database/questdb/migrations/migration";

/** The columns this migration creates. Frozen: later changes are new migrations. */
export const NETWORK_METRICS_V1_COLUMNS: readonly ColumnDefinition[] = [
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

/**
 * Matches the error ADD COLUMN raises for a column ILP schema-on-write created
 * after introspection; v2's drift check catches one created with another type.
 */
export const isDuplicateColumnError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("already exists") || normalized.includes("duplicate")
  );
};

const addColumn = (
  ctx: MigrationContext,
  column: ColumnDefinition
): Effect.Effect<void, MigrationError> =>
  ctx.query(buildAddColumnSql(column, ctx.table)).pipe(
    Effect.andThen(
      Effect.logInfo(
        `QuestDB schema migration: added column ${column.name} ${column.type}`
      )
    ),
    Effect.catch((error) =>
      isDuplicateColumnError(error.message)
        ? Effect.logInfo(
            `QuestDB schema migration: column ${column.name} was created concurrently, skipping`
          )
        : Effect.fail(error)
    )
  );

export const createNetworkMetrics: Migration = {
  version: 1,
  name: "create-network-metrics",
  up: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.query(
        buildCreateTableSql(ctx.table, NETWORK_METRICS_V1_COLUMNS)
      );
      const existing = (yield* listColumns(ctx, ctx.table)).map(
        (column) => column.name
      );
      for (const column of missingColumns(
        existing,
        NETWORK_METRICS_V1_COLUMNS
      )) {
        yield* addColumn(ctx, column);
      }
      // A WAL table shows an added column only once the ALTER has been applied.
      yield* awaitApplied(ctx, ctx.table);
    }),
};
