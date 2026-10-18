import { Context, Effect, Layer, type Scope } from "effect";
import { Client, type ClientConfig } from "pg";
import { ConfigService } from "@/infrastructure/config/config";
import {
  type MigrationContext,
  MigrationError,
} from "@/infrastructure/database/questdb/migrations/migration";
import {
  MIGRATIONS,
  NETWORK_METRICS_SHAPE,
} from "@/infrastructure/database/questdb/migrations/registry";
import { runMigrations } from "@/infrastructure/database/questdb/migrations/runner";
import { pgConnectionSettings } from "@/infrastructure/database/questdb/pgwire";
import { errorMessage } from "@/infrastructure/database/questdb/util";

// A table rewrite can outlast the pool's 5s timeout and QuestDB's default 60s
// query.timeout, so the migration session raises both to this.
export const MIGRATION_STATEMENT_TIMEOUT_MS = 30 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 10_000;

export interface MigrateOptions {
  /** Called with a short description of each step before it starts. */
  readonly onProgress?: (step: string) => Effect.Effect<void>;
  /** See {@link MigrationContext.canRewriteTables}. */
  readonly canRewriteTables: boolean;
}

export interface SchemaMigratorService {
  /** Brings the metrics table to the newest schema. */
  readonly migrate: (
    options: MigrateOptions
  ) => Effect.Effect<void, MigrationError>;
}

export class SchemaMigrator extends Context.Service<
  SchemaMigrator,
  SchemaMigratorService
>()("SchemaMigrator") {}

export const migrationClientConfig = (database: {
  readonly host: string;
  readonly pgPort: number;
}): ClientConfig => ({
  ...pgConnectionSettings(database),
  connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  query_timeout: MIGRATION_STATEMENT_TIMEOUT_MS,
  options: `-c statement_timeout=${MIGRATION_STATEMENT_TIMEOUT_MS}`,
});

export const pgMigrationContext = (
  client: Client,
  table: string,
  canRewriteTables: boolean
): MigrationContext => ({
  table,
  canRewriteTables,
  query: (sql, params) =>
    Effect.tryPromise({
      try: async () => (await client.query(sql, params && [...params])).rows,
      catch: (error) =>
        new MigrationError({
          step: "query",
          kind: "transient",
          message: errorMessage(error),
        }),
    }),
});

const acquireClient = (database: {
  readonly host: string;
  readonly pgPort: number;
}): Effect.Effect<Client, MigrationError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const client = new Client(migrationClientConfig(database));
        // An unhandled 'error' from a dropped client crashes the process; a
        // statement in flight rejects on its own, so the handler stays empty.
        client.on("error", () => {});
        await client.connect();
        return client;
      },
      catch: (error) =>
        new MigrationError({
          step: "connect",
          kind: "transient",
          message: `Could not connect to run migrations: ${errorMessage(error)}`,
        }),
    }),
    (client) => Effect.promise(() => client.end().catch(() => undefined))
  );

const make = Effect.gen(function* () {
  const { database } = yield* ConfigService;

  const migrate: SchemaMigratorService["migrate"] = ({
    onProgress,
    canRewriteTables,
  }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* acquireClient(database);
        yield* runMigrations(
          pgMigrationContext(client, database.table, canRewriteTables),
          {
            migrations: MIGRATIONS,
            target: NETWORK_METRICS_SHAPE,
            onProgress,
          }
        );
      })
    );

  return { migrate } satisfies SchemaMigratorService;
});

export const SchemaMigratorLive = Layer.effect(SchemaMigrator, make);
