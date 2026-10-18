import type { ColumnDefinition } from "@wan-monitor/shared/db-schema";
import type { MigrationRow } from "@/infrastructure/database/questdb/migrations/migration";

type DigestValue = string | number | null;

/** What a table holds, reduced to figures a faithful copy must reproduce. */
export interface TableDigest {
  readonly totals: Readonly<Record<string, DigestValue>>;
  readonly groups: Readonly<Record<string, number>>;
}

const APPROXIMATE_PREFIX = "approx_sum_";
const RELATIVE_TOLERANCE = 1e-9;

// Catches moved timestamps that min, max and the distinct count cannot see: the
// sum of timestamps modulo this prime changes when fewer than this many rows
// shift by 1µs in one direction.
const RESIDUE_MODULUS = 1_000_003;

const STRING_LIKE_TYPES = new Set(["STRING", "SYMBOL", "VARCHAR"]);

const columnFigures = ({ name, type }: ColumnDefinition): string[] => {
  const nonNull = `count(${name}) AS nn_${name}`;
  if (type === "TIMESTAMP") {
    return [
      nonNull,
      `cast(cast(min(${name}) as timestamp) as long) AS min_${name}`,
      `cast(cast(max(${name}) as timestamp) as long) AS max_${name}`,
      `count_distinct(${name}) AS distinct_${name}`,
      `sum(cast(cast(${name} as timestamp) as long) % ${RESIDUE_MODULUS}) AS residue_${name}`,
    ];
  }
  if (type === "LONG") return [nonNull, `sum(${name}) AS sum_${name}`];
  if (type === "DOUBLE") {
    return [nonNull, `sum(${name}) AS ${APPROXIMATE_PREFIX}${name}`];
  }
  if (STRING_LIKE_TYPES.has(type)) {
    // VARCHAR counts code points and STRING counts UTF-16 units, so lengths are
    // taken after casting to one type.
    return [nonNull, `sum(length(cast(${name} as varchar))) AS len_${name}`];
  }
  return [nonNull];
};

export const digestTotalsSql = (
  table: string,
  columns: readonly ColumnDefinition[]
): string =>
  `SELECT count() AS row_count, ${columns.flatMap(columnFigures).join(", ")} FROM ${table}`;

export const digestGroupsSql = (
  table: string,
  groupColumns: readonly string[]
): string => {
  const keys = groupColumns.join(", ");
  return `SELECT ${keys}, count() AS group_count FROM ${table} GROUP BY ${keys}`;
};

const digestValue = (value: unknown): DigestValue =>
  value === null || value === undefined
    ? null
    : typeof value === "number"
      ? value
      : String(value);

export const toDigest = (
  totalsRow: MigrationRow,
  groupRows: readonly MigrationRow[],
  groupColumns: readonly string[]
): TableDigest => ({
  totals: Object.fromEntries(
    Object.entries(totalsRow).map(([key, value]) => [key, digestValue(value)])
  ),
  groups: Object.fromEntries(
    groupRows.map((row) => [
      JSON.stringify(groupColumns.map((column) => digestValue(row[column]))),
      Number(row.group_count),
    ])
  ),
});

const sameFigure = (key: string, a: DigestValue, b: DigestValue): boolean => {
  if (a === null || b === null) return a === b;
  if (!key.startsWith(APPROXIMATE_PREFIX)) return String(a) === String(b);
  const [x, y] = [Number(a), Number(b)];
  return (
    Math.abs(x - y) <= RELATIVE_TOLERANCE * Math.max(Math.abs(x), Math.abs(y))
  );
};

/** `labels` name the two sides in each message. */
export const digestMismatches = (
  source: TableDigest,
  target: TableDigest,
  labels: readonly [string, string] = ["source", "copy"]
): readonly string[] => {
  const [from, to] = labels;
  const totalKeys = new Set([
    ...Object.keys(source.totals),
    ...Object.keys(target.totals),
  ]);
  const groupKeys = new Set([
    ...Object.keys(source.groups),
    ...Object.keys(target.groups),
  ]);

  return [
    ...[...totalKeys].flatMap((key) => {
      const [a, b] = [source.totals[key] ?? null, target.totals[key] ?? null];
      return sameFigure(key, a, b)
        ? []
        : [`${key}: ${a} in ${from}, ${b} in ${to}`];
    }),
    ...[...groupKeys].flatMap((key) => {
      const [a, b] = [source.groups[key] ?? 0, target.groups[key] ?? 0];
      return a === b ? [] : [`rows for ${key}: ${a} in ${from}, ${b} in ${to}`];
    }),
  ];
};
