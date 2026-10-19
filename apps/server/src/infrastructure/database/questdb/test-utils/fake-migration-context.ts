import {
  type ColumnDefinition,
  NETWORK_METRICS_COLUMNS,
} from "@wan-monitor/shared/db-schema";
import { Effect } from "effect";
import {
  type MigrationContext,
  MigrationError,
  type MigrationRow,
} from "@/infrastructure/database/questdb/migrations/migration";
import type { LiveColumn } from "@/infrastructure/database/questdb/migrations/schema";
import { NETWORK_METRICS_V2_COLUMNS } from "@/infrastructure/database/questdb/migrations/v2-conform-network-metrics";

export interface FakeWalStatus {
  readonly suspended: boolean;
  readonly writerTxn: number;
  readonly sequencerTxn: number;
}

export interface FakeDigest {
  readonly totals: MigrationRow;
  readonly groups: readonly MigrationRow[];
}

const asLive = (columns: readonly ColumnDefinition[]): readonly LiveColumn[] =>
  columns.map((column) => ({
    ...column,
    designated: column.name === "timestamp",
  }));

export const canonicalLiveColumns = asLive(NETWORK_METRICS_COLUMNS);

/** A table as it stands once v2 has run, before any later migration added a column. */
export const v2LiveColumns = asLive(NETWORK_METRICS_V2_COLUMNS);

export const sameDigest: FakeDigest = {
  totals: { row_count: "3", nn_latency: "3" },
  groups: [{ source: "ping", host: "8.8.8.8", group_count: "3" }],
};

interface FakeOptions {
  readonly table: string;
  readonly tables?: readonly string[];
  readonly columns?: Readonly<Record<string, readonly LiveColumn[]>>;
  readonly wal?: Readonly<
    Record<
      string,
      FakeWalStatus | ((statements: readonly string[]) => FakeWalStatus)
    >
  >;
  /** The digest a table reports, given every statement run so far. */
  readonly digestFor?: (
    table: string,
    statements: readonly string[]
  ) => FakeDigest;
  /** Rows for statements the fake does not model; return undefined to fall through to the built-in answers. */
  readonly answers?: (
    sql: string,
    statements: readonly string[]
  ) => readonly MigrationRow[] | undefined;
  readonly ledger?: readonly number[];
  /** Whether this process may rename and drop tables; defaults to true. */
  readonly canRewriteTables?: boolean;
  /** Fails any statement for which this returns an error. */
  readonly failOn?: (sql: string) => MigrationError | undefined;
}

const tableAfter = (sql: string, keyword: RegExp): string => {
  const match = sql.match(keyword);
  if (match?.[1] === undefined) throw new Error(`fake cannot parse: ${sql}`);
  return match[1];
};

/** An in-memory stand-in for the migrations' SQL: it tracks which tables exist and records every statement. */
export const createFakeContext = (options: FakeOptions) => {
  const tables = new Set(options.tables ?? []);
  const ledger = [...(options.ledger ?? [])];
  const failures = new Map<number, string>();
  const statements: string[] = [];

  const query: MigrationContext["query"] = (sql) =>
    Effect.suspend(() => {
      statements.push(sql);
      const failure = options.failOn?.(sql);
      if (failure !== undefined) return Effect.fail(failure);
      return Effect.succeed(answer(sql));
    });

  const digestOf = (name: string): FakeDigest =>
    options.digestFor?.(name, statements) ?? sameDigest;

  const answer = (sql: string): readonly MigrationRow[] => {
    const scripted = options.answers?.(sql, statements);
    if (scripted !== undefined) return scripted;
    if (sql.includes("FROM tables()")) {
      return [...tables]
        .filter((name) => sql.includes(`'${name}'`))
        .map((name) => ({ table_name: name }));
    }
    if (sql.includes("table_columns(")) {
      const name = tableAfter(sql, /table_columns\('([^']+)'\)/);
      return (options.columns?.[name] ?? canonicalLiveColumns).map(
        (column) => ({ ...column })
      );
    }
    if (sql.includes("FROM wal_tables()")) {
      const name = tableAfter(sql, /name = '([^']+)'/);
      const status = options.wal?.[name];
      if (status === undefined) return [];
      const { suspended, writerTxn, sequencerTxn } =
        typeof status === "function" ? status(statements) : status;
      // pg returns BIGINT columns as strings.
      return [
        {
          suspended,
          writerTxn: String(writerTxn),
          sequencerTxn: String(sequencerTxn),
        },
      ];
    }
    if (sql.includes("AS row_count")) {
      const name = tableAfter(sql, /FROM (\S+)$/);
      return [digestOf(name).totals];
    }
    if (sql.includes("AS group_count")) {
      const name = tableAfter(sql, /FROM (\S+) GROUP BY/);
      return digestOf(name).groups;
    }
    if (sql.startsWith("SELECT max(version)")) {
      return [{ v: ledger.length === 0 ? null : Math.max(...ledger) }];
    }
    if (sql.startsWith("SELECT name FROM") && sql.includes("_migrations")) {
      const version = Number(tableAfter(sql, /WHERE version = -(\d+)$/));
      const message = failures.get(version);
      return message === undefined ? [] : [{ name: message }];
    }
    if (sql.startsWith("INSERT INTO") && sql.includes("_migrations")) {
      const version = Number(tableAfter(sql, /VALUES \((-?\d+),/));
      if (version < 0) {
        failures.set(
          -version,
          tableAfter(
            sql,
            /VALUES \(-\d+, '((?:[^']|'')*)', now\(\)\)$/
          ).replaceAll("''", "'")
        );
      } else {
        ledger.push(version);
      }
      return [];
    }
    if (/^CREATE TABLE IF NOT EXISTS/.test(sql)) {
      tables.add(tableAfter(sql, /CREATE TABLE IF NOT EXISTS (\S+)/));
    } else if (/^DROP TABLE/.test(sql)) {
      tables.delete(tableAfter(sql, /DROP TABLE (?:IF EXISTS )?(\S+)/));
    } else if (/^RENAME TABLE/.test(sql)) {
      const from = tableAfter(sql, /RENAME TABLE (\S+) TO/);
      const to = tableAfter(sql, /TO (\S+)$/);
      tables.delete(from);
      tables.add(to);
    }
    return [];
  };

  return {
    ctx: {
      table: options.table,
      canRewriteTables: options.canRewriteTables ?? true,
      query,
    } satisfies MigrationContext,
    statements,
    tables,
    ledger,
    /** Messages of recorded failures, by the version they stopped. */
    failures,
  };
};

export const terminal = (message: string): MigrationError =>
  new MigrationError({ step: "test", message, kind: "terminal" });

export const transient = (message: string): MigrationError =>
  new MigrationError({ step: "test", message, kind: "transient" });

/** The statements a remedy message prints between literal backticks, in order. */
export const backticked = (message: string): readonly string[] =>
  [...message.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
