import { Duration, Effect } from "effect";
import {
  existingTables,
  listColumns,
} from "@/infrastructure/database/questdb/migrations/introspect";
import {
  acceptAsAppliedSql,
  ledgerName,
} from "@/infrastructure/database/questdb/migrations/ledger";
import {
  type Migration,
  type MigrationContext,
  MigrationError,
  terminalError,
} from "@/infrastructure/database/questdb/migrations/migration";
import { recoverTableState } from "@/infrastructure/database/questdb/migrations/rebuild";
import {
  describeDrift,
  driftRemedies,
  schemaDrift,
  type TableShape,
} from "@/infrastructure/database/questdb/migrations/schema";

export interface MigrationPlan {
  readonly migrations: readonly Migration[];
  /** The schema the table must have once every migration has run. */
  readonly target: TableShape;
  /** Called with a short description of each step before it starts. */
  readonly onProgress?: (step: string) => Effect.Effect<void>;
}

const terminal = (message: string): MigrationError =>
  terminalError("check", message);

const appliedVersion = (
  ctx: MigrationContext
): Effect.Effect<number, MigrationError> =>
  ctx
    .query(
      `SELECT max(version) AS v FROM ${ledgerName(ctx.table)} WHERE version > 0`
    )
    .pipe(Effect.map((rows) => Number(rows[0]?.v ?? 0)));

// A migration that fails with a sticky error is recorded as a row with the
// negated version. Reads of applied versions ignore that row, and any rerun of
// the migration is refused.
const recordedFailure = (
  ctx: MigrationContext,
  migration: Migration
): Effect.Effect<string | undefined, MigrationError> =>
  ctx
    .query(
      `SELECT name FROM ${ledgerName(ctx.table)} WHERE version = ${-migration.version}`
    )
    .pipe(
      Effect.map((rows) =>
        rows[0] === undefined ? undefined : String(rows[0].name)
      )
    );

const recordFailure = (
  ctx: MigrationContext,
  migration: Migration,
  message: string
): Effect.Effect<void, MigrationError> =>
  Effect.asVoid(
    ctx.query(
      `INSERT INTO ${ledgerName(ctx.table)} VALUES (${-migration.version}, '${message.replaceAll("'", "''")}', now())`
    )
  );

const apply = (
  ctx: MigrationContext,
  migration: Migration
): Effect.Effect<void, MigrationError> =>
  Effect.gen(function* () {
    const earlier = yield* recordedFailure(ctx, migration);
    if (earlier !== undefined) {
      return yield* Effect.fail(
        terminal(
          `Migration v${migration.version} (${migration.name}) failed verification on an earlier start and is not run again. ${earlier} The migration's in-place change already ran. To accept the table as it is, record only this version as applied with \`${acceptAsAppliedSql(ledgerName(ctx.table), migration)}\`. The server continues on its next retry or restart.`
        )
      );
    }
    const [elapsed] = yield* Effect.timed(
      migration.up(ctx).pipe(
        Effect.tapError((error) =>
          error.sticky === true
            ? recordFailure(ctx, migration, error.message)
            : Effect.void
        ),
        Effect.mapError(
          (error) =>
            new MigrationError({
              step: error.step,
              kind: error.kind,
              message: `Migration v${migration.version} (${migration.name}) failed: ${error.message}`,
            })
        )
      )
    );
    yield* ctx.query(acceptAsAppliedSql(ledgerName(ctx.table), migration));
    yield* Effect.logInfo(
      `QuestDB migration v${migration.version} (${migration.name}) applied in ${Duration.toMillis(elapsed)}ms`
    );
  });

const verifySchema = (
  ctx: MigrationContext,
  target: TableShape
): Effect.Effect<void, MigrationError> =>
  Effect.gen(function* () {
    const ledger = ledgerName(ctx.table);
    if (!(yield* existingTables(ctx, [ctx.table])).has(ctx.table)) {
      return yield* Effect.fail(
        terminal(
          `${ctx.table} does not exist although its migrations are recorded. Drop ${ledger} and restart to recreate ${ctx.table}.`
        )
      );
    }
    const drift = schemaDrift(
      yield* listColumns(ctx, ctx.table),
      target.columns
    );
    const differences = describeDrift(drift);
    if (differences.length > 0) {
      return yield* Effect.fail(
        terminal(
          `${ctx.table} does not match the schema this build expects (${differences.join("; ")}). ${driftRemedies(drift, ctx.table, target.columns).join(" ")}`
        )
      );
    }
  });

/** Brings the table to the newest schema, then checks it against `plan.target`. */
export const runMigrations = (
  ctx: MigrationContext,
  plan: MigrationPlan
): Effect.Effect<void, MigrationError> =>
  Effect.gen(function* () {
    const ledger = ledgerName(ctx.table);
    yield* ctx.query(
      `CREATE TABLE IF NOT EXISTS ${ledger} (version INT, name STRING, applied_at TIMESTAMP) TIMESTAMP(applied_at) PARTITION BY NONE`
    );

    const applied = yield* appliedVersion(ctx);
    const latest = plan.migrations.at(-1)?.version ?? 0;
    if (applied > latest) {
      return yield* Effect.fail(
        terminal(
          `${ledger} records schema version ${applied}, newer than the version ${latest} this build knows. Upgrade the application: this build will not run against a newer schema.`
        )
      );
    }

    yield* recoverTableState(ctx, plan.target, plan.onProgress);

    for (const migration of plan.migrations) {
      if (migration.version <= applied) continue;
      yield* plan.onProgress?.(`v${migration.version}: ${migration.name}`) ??
        Effect.void;
      yield* apply(ctx, migration);
    }

    yield* verifySchema(ctx, plan.target);
  });
