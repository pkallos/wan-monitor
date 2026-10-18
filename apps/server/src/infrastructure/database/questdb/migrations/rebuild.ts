import { buildCreateTableSql } from "@wan-monitor/shared/db-schema";
import { Effect } from "effect";
import { digestMismatches } from "@/infrastructure/database/questdb/migrations/digest";
import {
  awaitApplied,
  existingTables,
  listColumns,
  readDigest,
  walStatus,
} from "@/infrastructure/database/questdb/migrations/introspect";
import {
  type MigrationContext,
  type MigrationError,
  terminalError,
  transientError,
} from "@/infrastructure/database/questdb/migrations/migration";
import {
  rebuildCopySql,
  type TableShape,
} from "@/infrastructure/database/questdb/migrations/schema";

const rebuildName = (table: string): string => `${table}__rebuild`;
const previousName = (table: string): string => `${table}__previous`;

/**
 * Proves `to` holds what `from` holds and returns the row count. `outcome`
 * ends a failure's message, telling the operator what became of each table.
 */
const verifyCopy = (
  ctx: MigrationContext,
  from: string,
  to: string,
  shape: TableShape,
  outcome: string
): Effect.Effect<number, MigrationError> =>
  Effect.gen(function* () {
    const liveColumns = yield* listColumns(ctx, from);
    const known = new Set(shape.columns.map((column) => column.name));
    const unknown = liveColumns
      .map((column) => column.name)
      .filter((name) => !known.has(name));
    if (unknown.length > 0) {
      return yield* Effect.fail(
        terminalError(
          "verify",
          `${from} has columns this build does not know (${unknown.join(", ")}), which a copy would lose. ${outcome}`
        )
      );
    }
    const sourceColumns = new Set(liveColumns.map((column) => column.name));
    const columns = shape.columns.filter((column) =>
      sourceColumns.has(column.name)
    );
    const source = yield* readDigest(ctx, from, columns, shape.groupColumns);
    const copy = yield* readDigest(ctx, to, columns, shape.groupColumns);
    const mismatches = digestMismatches(source, copy);
    if (mismatches.length > 0) {
      return yield* Effect.fail(
        terminalError(
          "verify",
          `${to} does not match ${from} (${mismatches.slice(0, 5).join("; ")}). ${outcome}`
        )
      );
    }
    return Number(source.totals.row_count);
  });

const dropTable = (
  ctx: MigrationContext,
  table: string
): Effect.Effect<void, MigrationError> =>
  Effect.asVoid(ctx.query(`DROP TABLE IF EXISTS ${table}`));

const keptOriginal = (table: string, previous: string): string =>
  `${previous} was kept. Copy into ${table} any rows of ${previous} that ${table} lacks; the next attempt verifies the two again and drops ${previous} once they match.`;

/** Drops the renamed original once the swapped-in copy matches it and the original took no write meanwhile. */
const finishSwap = (
  ctx: MigrationContext,
  shape: TableShape
): Effect.Effect<void, MigrationError> =>
  Effect.gen(function* () {
    const table = ctx.table;
    const previous = previousName(table);
    yield* awaitApplied(ctx, table);
    const before = yield* awaitApplied(ctx, previous);
    const rows = yield* verifyCopy(
      ctx,
      previous,
      table,
      shape,
      keptOriginal(table, previous)
    );
    const after = yield* walStatus(ctx, previous);
    if (before?.sequencerTxn !== after?.sequencerTxn) {
      return yield* Effect.fail(
        terminalError(
          "verify",
          `${previous} took writes while ${table} was being verified against it. ${keptOriginal(table, previous)}`
        )
      );
    }
    yield* ctx.query(`DROP TABLE ${previous}`);
    yield* Effect.logInfo(
      `QuestDB rebuild of ${table} verified and finished (${rows} rows)`
    );
  });

const copyAndVerify = (
  ctx: MigrationContext,
  shape: TableShape
): Effect.Effect<void, MigrationError> =>
  Effect.gen(function* () {
    const table = ctx.table;
    const rebuild = rebuildName(table);

    yield* dropTable(ctx, rebuild);
    const source = yield* awaitApplied(ctx, table);
    const sourceColumns = (yield* listColumns(ctx, table)).map(
      (column) => column.name
    );

    yield* ctx.query(buildCreateTableSql(rebuild, shape.columns));
    yield* ctx.query(
      rebuildCopySql(table, rebuild, shape.columns, sourceColumns)
    );
    yield* awaitApplied(
      ctx,
      rebuild,
      () =>
        `${rebuild} was suspended while it was being written, most often because the disk is full. It was dropped and ${table} is unchanged. Free disk space and restart the server.`
    );
    const rows = yield* verifyCopy(
      ctx,
      table,
      rebuild,
      shape,
      `${rebuild} was removed and ${table} is unchanged.`
    );

    const after = yield* walStatus(ctx, table);
    if (source?.sequencerTxn !== after?.sequencerTxn) {
      return yield* Effect.fail(
        transientError(
          "copy",
          `${table} changed while it was copied, so the copy is stale`
        )
      );
    }
    yield* Effect.logInfo(
      `QuestDB rebuild of ${table}: copied and verified ${rows} rows`
    );
  }).pipe(
    Effect.onError(() => Effect.ignore(dropTable(ctx, rebuildName(ctx.table))))
  );

/**
 * Rewrites `ctx.table` into `shape` through a verified copy. Callers must check
 * {@link MigrationContext.canRewriteTables} first.
 */
export const rebuildTable = (
  ctx: MigrationContext,
  shape: TableShape
): Effect.Effect<void, MigrationError> =>
  Effect.gen(function* () {
    yield* copyAndVerify(ctx, shape);
    yield* ctx.query(`RENAME TABLE ${ctx.table} TO ${previousName(ctx.table)}`);
    yield* ctx.query(`RENAME TABLE ${rebuildName(ctx.table)} TO ${ctx.table}`);
    yield* finishSwap(ctx, shape);
  });

export const requireRewriteAllowed = (
  ctx: MigrationContext,
  step: string,
  subject: string
): Effect.Effect<void, MigrationError> =>
  ctx.canRewriteTables
    ? Effect.void
    : Effect.fail(
        terminalError(
          step,
          `${subject} is only done before the server opens its first ILP connection, so that no write can reach the table being replaced. Restart the server.`
        )
      );

const renameTable = (
  ctx: MigrationContext,
  from: string,
  to: string
): Effect.Effect<void, MigrationError> =>
  Effect.asVoid(ctx.query(`RENAME TABLE ${from} TO ${to}`));

/** Which of the table, its copy and its renamed original exist: `T`, `R`, `P` or `-` for absent. */
type TableState = `${"T" | "-"}${"R" | "-"}${"P" | "-"}`;

const refuse = (message: string): Effect.Effect<void, MigrationError> =>
  Effect.fail(terminalError("recovery", message));

const recoveries = (
  ctx: MigrationContext,
  shape: TableShape
): Record<TableState, Effect.Effect<void, MigrationError>> => {
  const table = ctx.table;
  const rebuild = rebuildName(table);
  const previous = previousName(table);
  const rewriting = (
    recovery: Effect.Effect<void, MigrationError>
  ): Effect.Effect<void, MigrationError> =>
    requireRewriteAllowed(
      ctx,
      "recovery",
      `Recovering the interrupted rebuild of ${table}`
    ).pipe(Effect.andThen(recovery));
  return {
    "---": Effect.void,
    "T--": Effect.void,
    "TR-": dropTable(ctx, rebuild),
    "-RP": rewriting(
      renameTable(ctx, rebuild, table).pipe(
        Effect.andThen(finishSwap(ctx, shape))
      )
    ),
    "T-P": rewriting(finishSwap(ctx, shape)),
    "--P": rewriting(renameTable(ctx, previous, table)),
    "-R-": refuse(
      `${rebuild} exists but ${table} and ${previous} do not, so the copy has no original to verify against. Restore ${table} from a backup, or rename ${rebuild} to ${table} if ${rebuild} is known to be complete.`
    ),
    TRP: refuse(
      `${table}, ${rebuild} and ${previous} all exist. Compare them and drop the ones that are not needed.`
    ),
  };
};

/**
 * Brings the tables an interrupted {@link rebuildTable} left behind to a state
 * migrations can start from, or refuses when the right choice needs a person.
 */
export const recoverTableState = (
  ctx: MigrationContext,
  shape: TableShape,
  onProgress?: (step: string) => Effect.Effect<void>
): Effect.Effect<void, MigrationError> =>
  Effect.gen(function* () {
    const present = yield* existingTables(ctx, [
      ctx.table,
      rebuildName(ctx.table),
      previousName(ctx.table),
    ]);
    const t = present.has(ctx.table) ? "T" : "-";
    const r = present.has(rebuildName(ctx.table)) ? "R" : "-";
    const p = present.has(previousName(ctx.table)) ? "P" : "-";
    const state = `${t}${r}${p}` as const;

    if (state !== "---" && state !== "T--") {
      yield* Effect.logWarning(
        `QuestDB table recovery for ${ctx.table}: found ${[...present].join(", ")}`
      );
      yield* onProgress?.(
        `recovering an interrupted rebuild of ${ctx.table}`
      ) ?? Effect.void;
    }
    yield* recoveries(ctx, shape)[state];
  });
