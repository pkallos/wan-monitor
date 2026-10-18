/**
 * Canonical QuestDB schema for the `network_metrics` table.
 *
 * This module is the single source of truth for the table's end-state shape.
 * It is consumed by the server's schema migrations (production/local dev), the
 * server integration-test setup, and the E2E seed fixture, so that every
 * environment creates an identical table. Changing the columns needs a new
 * migration; the migrator's integration test fails until there is one.
 *
 * The module is intentionally dependency-free (pure strings/arrays) so it can
 * be imported from any runtime context (Effect server, Vitest, Playwright)
 * without pulling in a framework dependency graph.
 */

/** The default metrics table name. */
export const NETWORK_METRICS_TABLE = "network_metrics";

/** A single QuestDB column definition. */
export interface ColumnDefinition {
  readonly name: string;
  /** QuestDB column type (e.g. `SYMBOL`, `DOUBLE`, `LONG`, `STRING`). */
  readonly type: string;
}

/**
 * The designated timestamp column. A table has at most one, and partitioned
 * WAL tables require it.
 */
export const DESIGNATED_TIMESTAMP = "timestamp";

/**
 * The canonical column set for `network_metrics`, in declaration order.
 *
 * Every column queried by the server (see `queries.ts`) must appear here so a
 * freshly created table can satisfy all queries without relying on ILP
 * schema-on-write to lazily create columns.
 */
export const NETWORK_METRICS_COLUMNS: readonly ColumnDefinition[] = [
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
 * Build the idempotent `CREATE TABLE IF NOT EXISTS` statement for the canonical
 * schema. The table uses WAL and daily partitioning, so test and production
 * tables behave identically.
 */
export const buildCreateTableSql = (
  table: string = NETWORK_METRICS_TABLE,
  columnDefinitions: readonly ColumnDefinition[] = NETWORK_METRICS_COLUMNS
): string => {
  const columns = columnDefinitions
    .map((column) => `  ${column.name} ${column.type}`)
    .join(",\n");

  return `CREATE TABLE IF NOT EXISTS ${table} (\n${columns}\n) TIMESTAMP(${DESIGNATED_TIMESTAMP}) PARTITION BY DAY WAL;`;
};

/**
 * Build a forward-only `ALTER TABLE ADD COLUMN` statement for a single column.
 * A migration uses it when a pre-existing table lacks that column. It only
 * adds, so no existing data is affected.
 */
export const buildAddColumnSql = (
  column: ColumnDefinition,
  table: string = NETWORK_METRICS_TABLE
): string => `ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.type};`;

/**
 * Given the column names that currently exist on the table, return the
 * entries of `columns` whose names are not among them.
 */
export const missingColumns = (
  existing: readonly string[],
  columns: readonly ColumnDefinition[] = NETWORK_METRICS_COLUMNS
): readonly ColumnDefinition[] =>
  columns.filter((column) => !existing.includes(column.name));
