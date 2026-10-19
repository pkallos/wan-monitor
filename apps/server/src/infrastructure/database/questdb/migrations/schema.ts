import {
  buildAddColumnSql,
  type ColumnDefinition,
  DESIGNATED_TIMESTAMP,
} from "@wan-monitor/shared/db-schema";

/** A column as the database reports it through `table_columns()`. */
export interface LiveColumn extends ColumnDefinition {
  readonly designated: boolean;
}

/** The columns and grouping a table is verified and rebuilt against. */
export interface TableShape {
  readonly columns: readonly ColumnDefinition[];
  /** Columns whose per-group row counts a copy must preserve. */
  readonly groupColumns: readonly string[];
}

export interface SchemaDrift {
  readonly retyped: readonly {
    readonly name: string;
    readonly actual: string;
    readonly expected: string;
  }[];
  readonly extra: readonly string[];
  readonly missing: readonly string[];
  readonly designatedOk: boolean;
}

export const schemaDrift = (
  actual: readonly LiveColumn[],
  target: readonly ColumnDefinition[]
): SchemaDrift => {
  const expectedByName = new Map(target.map((column) => [column.name, column]));
  const actualByName = new Map(actual.map((column) => [column.name, column]));
  const designated = actual.find((column) => column.designated);
  const expectedDesignated = expectedByName.get(DESIGNATED_TIMESTAMP);

  return {
    retyped: actual.flatMap((column) => {
      const expected = expectedByName.get(column.name);
      return expected !== undefined && expected.type !== column.type
        ? [{ name: column.name, actual: column.type, expected: expected.type }]
        : [];
    }),
    extra: actual
      .filter((column) => !expectedByName.has(column.name))
      .map((column) => column.name),
    missing: target
      .filter((column) => !actualByName.has(column.name))
      .map((column) => column.name),
    designatedOk:
      designated !== undefined &&
      designated.name === DESIGNATED_TIMESTAMP &&
      designated.type === expectedDesignated?.type,
  };
};

/** Retyped columns and a wrong designated timestamp can only be fixed by rewriting the table. */
export const needsRebuild = (drift: SchemaDrift): boolean =>
  drift.retyped.length > 0 || !drift.designatedOk;

export const describeDrift = (drift: SchemaDrift): readonly string[] => [
  ...drift.retyped.map(
    ({ name, actual, expected }) => `${name} is ${actual}, expected ${expected}`
  ),
  ...(drift.designatedOk
    ? []
    : [
        `the designated timestamp is not the ${DESIGNATED_TIMESTAMP} column of type TIMESTAMP`,
      ]),
  ...drift.extra.map((name) => `unexpected column ${name}`),
  ...drift.missing.map((name) => `missing column ${name}`),
];

/**
 * Each remedy is a step the operator takes without dropping the migration
 * ledger: add the columns the table lacks, drop extra columns once their data
 * is no longer needed, and restore from a backup anything that needs a
 * rewrite.
 */
export const driftRemedies = (
  drift: SchemaDrift,
  table: string,
  target: readonly ColumnDefinition[]
): readonly string[] => {
  const addable = target.filter(
    (column) =>
      drift.missing.includes(column.name) &&
      column.name !== DESIGNATED_TIMESTAMP
  );
  const needsBackup =
    needsRebuild(drift) || drift.missing.includes(DESIGNATED_TIMESTAMP);
  return [
    ...addable.map(
      (column) =>
        `Add ${column.name} with \`${buildAddColumnSql(column, table)}\`.`
    ),
    ...(drift.extra.length > 0
      ? [
          `Unexpected columns (${drift.extra.join(", ")}) are never dropped automatically: drop them yourself once their data is no longer needed.`,
        ]
      : []),
    ...(needsBackup
      ? [`Restore ${table} from a backup taken before its schema diverged.`]
      : []),
  ];
};

/** A column the source lacks is filled with NULL. */
export const rebuildCopySql = (
  source: string,
  target: string,
  targetColumns: readonly ColumnDefinition[],
  sourceColumnNames: readonly string[]
): string => {
  const present = new Set(sourceColumnNames);
  const names = targetColumns.map((column) => column.name).join(", ");
  const selects = targetColumns
    .map((column) =>
      present.has(column.name)
        ? `cast(${column.name} as ${column.type})`
        : `cast(NULL as ${column.type})`
    )
    .join(", ");
  return `INSERT INTO ${target} (${names}) SELECT ${selects} FROM ${source}`;
};
