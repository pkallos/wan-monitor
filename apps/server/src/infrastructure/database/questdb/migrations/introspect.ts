import type { ColumnDefinition } from "@wan-monitor/shared/db-schema";
import { Clock, Duration, Effect } from "effect";
import {
  digestGroupsSql,
  digestTotalsSql,
  type TableDigest,
  toDigest,
} from "@/infrastructure/database/questdb/migrations/digest";
import {
  type MigrationContext,
  type MigrationError,
  type MigrationRow,
  terminalError,
  transientError,
} from "@/infrastructure/database/questdb/migrations/migration";
import type { LiveColumn } from "@/infrastructure/database/questdb/migrations/schema";

export const listColumns = (
  ctx: MigrationContext,
  table: string
): Effect.Effect<readonly LiveColumn[], MigrationError> =>
  ctx
    .query(
      `SELECT "column" AS name, type, designated FROM table_columns('${table}')`
    )
    .pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          name: String(row.name),
          type: String(row.type),
          designated: row.designated === true,
        }))
      )
    );

export const existingTables = (
  ctx: MigrationContext,
  names: readonly string[]
): Effect.Effect<ReadonlySet<string>, MigrationError> =>
  ctx
    .query(
      `SELECT table_name FROM tables() WHERE table_name IN (${names
        .map((name) => `'${name}'`)
        .join(", ")})`
    )
    .pipe(
      Effect.map((rows) => new Set(rows.map((row) => String(row.table_name))))
    );

export const readDigest = (
  ctx: MigrationContext,
  table: string,
  columns: readonly ColumnDefinition[],
  groupColumns: readonly string[]
): Effect.Effect<TableDigest, MigrationError> =>
  Effect.gen(function* () {
    const totals = yield* ctx.query(digestTotalsSql(table, columns));
    const groups = yield* ctx.query(digestGroupsSql(table, groupColumns));
    return toDigest(totals[0] ?? {}, groups, groupColumns);
  });

const APPLY_DEADLINE_MINUTES = 30;
const APPLY_DEADLINE_MS = APPLY_DEADLINE_MINUTES * 60_000;
const APPLY_POLL_INTERVAL = Duration.millis(500);

export interface WalStatus {
  readonly suspended: boolean;
  readonly writerTxn: number;
  readonly sequencerTxn: number;
}

/** Undefined for a table that is not a WAL table. */
export const walStatus = (
  ctx: MigrationContext,
  table: string
): Effect.Effect<WalStatus | undefined, MigrationError> =>
  ctx
    .query(
      `SELECT suspended, writerTxn, sequencerTxn FROM wal_tables() WHERE name = '${table}'`
    )
    .pipe(
      Effect.map((rows) => {
        const row: MigrationRow | undefined = rows[0];
        return row === undefined
          ? undefined
          : {
              suspended: row.suspended === true,
              writerTxn: Number(row.writerTxn),
              sequencerTxn: Number(row.sequencerTxn),
            };
      })
    );

/** Fails if the table is suspended with unapplied transactions or misses the deadline. */
export const awaitApplied = (
  ctx: MigrationContext,
  table: string,
  suspendedMessage: (unapplied: number) => string = (unapplied) =>
    `${table} is suspended with ${unapplied} unapplied transaction(s). Resume it (ALTER TABLE ${table} RESUME WAL) and restart.`
): Effect.Effect<WalStatus | undefined, MigrationError> =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    while (true) {
      const status = yield* walStatus(ctx, table);
      if (status === undefined || status.writerTxn >= status.sequencerTxn) {
        return status;
      }
      if (status.suspended) {
        return yield* Effect.fail(
          terminalError(
            "wait-applied",
            suspendedMessage(status.sequencerTxn - status.writerTxn)
          )
        );
      }
      const now = yield* Clock.currentTimeMillis;
      if (now - startedAt > APPLY_DEADLINE_MS) {
        return yield* Effect.fail(
          transientError(
            "wait-applied",
            `${table} did not apply its pending transactions within ${APPLY_DEADLINE_MINUTES} minutes`
          )
        );
      }
      yield* Effect.sleep(APPLY_POLL_INTERVAL);
    }
  });
