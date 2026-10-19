import {
  buildAddColumnSql,
  type ColumnDefinition,
} from "@wan-monitor/shared/db-schema";
import { Effect } from "effect";
import {
  awaitApplied,
  listColumns,
} from "@/infrastructure/database/questdb/migrations/introspect";
import type { Migration } from "@/infrastructure/database/questdb/migrations/migration";
import { isDuplicateColumnError } from "@/infrastructure/database/questdb/migrations/v1-create-network-metrics";

/** The column this migration adds. Frozen: later changes are new migrations. */
export const PING_DURATION_COLUMN: ColumnDefinition = {
  name: "duration_ms",
  type: "DOUBLE",
};

/** Adds the measured length of each ping. Rows written before this migration keep NULL. */
export const addPingDuration: Migration = {
  version: 4,
  name: "add-ping-duration",
  up: (ctx) =>
    Effect.gen(function* () {
      const existing = yield* listColumns(ctx, ctx.table);
      if (
        existing.some((column) => column.name === PING_DURATION_COLUMN.name)
      ) {
        yield* Effect.logInfo(
          `QuestDB schema migration: ${ctx.table} already has ${PING_DURATION_COLUMN.name}`
        );
        return;
      }
      yield* ctx.query(buildAddColumnSql(PING_DURATION_COLUMN, ctx.table)).pipe(
        Effect.andThen(
          Effect.logInfo(
            `QuestDB schema migration: added column ${PING_DURATION_COLUMN.name} ${PING_DURATION_COLUMN.type}`
          )
        ),
        Effect.catch((error) =>
          isDuplicateColumnError(error.message)
            ? Effect.logInfo(
                `QuestDB schema migration: column ${PING_DURATION_COLUMN.name} was created concurrently, skipping`
              )
            : Effect.fail(error)
        )
      );
      // A WAL table shows an added column only once the ALTER has been applied.
      yield* awaitApplied(ctx, ctx.table);
    }),
};
