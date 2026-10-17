import { describe, expect, it } from "@effect/vitest";
import {
  type ColumnDefinition,
  NETWORK_METRICS_COLUMNS,
} from "@wan-monitor/shared/db-schema";
import {
  describeDrift,
  type LiveColumn,
  needsRebuild,
  rebuildCopySql,
  schemaDrift,
} from "@/infrastructure/database/questdb/migrations/schema";

const live = (columns: readonly ColumnDefinition[]): LiveColumn[] =>
  columns.map((column) => ({
    ...column,
    designated: column.name === "timestamp",
  }));

const withType = (name: string, type: string): LiveColumn[] =>
  live(NETWORK_METRICS_COLUMNS).map((column) =>
    column.name === name ? { ...column, type } : column
  );

describe("schemaDrift", () => {
  it("reports no drift for the canonical schema", () => {
    expect(
      schemaDrift(live(NETWORK_METRICS_COLUMNS), NETWORK_METRICS_COLUMNS)
    ).toEqual({
      retyped: [],
      extra: [],
      missing: [],
      designatedOk: true,
    });
  });

  it("flags a nanosecond designated timestamp as retyped and not ok", () => {
    const drift = schemaDrift(
      withType("timestamp", "TIMESTAMP_NS"),
      NETWORK_METRICS_COLUMNS
    );

    expect(drift.retyped).toEqual([
      { name: "timestamp", actual: "TIMESTAMP_NS", expected: "TIMESTAMP" },
    ]);
    expect(drift.designatedOk).toBe(false);
    expect(needsRebuild(drift)).toBe(true);
  });

  it("flags VARCHAR where the schema declares STRING", () => {
    const drift = schemaDrift(
      withType("isp", "VARCHAR"),
      NETWORK_METRICS_COLUMNS
    );

    expect(drift.retyped).toEqual([
      { name: "isp", actual: "VARCHAR", expected: "STRING" },
    ]);
    expect(drift.designatedOk).toBe(true);
    expect(needsRebuild(drift)).toBe(true);
  });

  it("flags SYMBOL where the schema declares STRING", () => {
    const drift = schemaDrift(
      withType("connectivity_status", "SYMBOL"),
      NETWORK_METRICS_COLUMNS
    );

    expect(drift.retyped).toEqual([
      { name: "connectivity_status", actual: "SYMBOL", expected: "STRING" },
    ]);
  });

  it("reports a column outside the schema as extra without asking for a rebuild", () => {
    const drift = schemaDrift(
      [
        ...live(NETWORK_METRICS_COLUMNS),
        { name: "note", type: "STRING", designated: false },
      ],
      NETWORK_METRICS_COLUMNS
    );

    expect(drift.extra).toEqual(["note"]);
    expect(needsRebuild(drift)).toBe(false);
  });

  it("reports a missing column without asking for a rebuild", () => {
    const drift = schemaDrift(
      live(NETWORK_METRICS_COLUMNS.filter((column) => column.name !== "isp")),
      NETWORK_METRICS_COLUMNS
    );

    expect(drift.missing).toEqual(["isp"]);
    expect(drift.retyped).toEqual([]);
    expect(needsRebuild(drift)).toBe(false);
  });

  it("ignores column order", () => {
    const reversed = [...live(NETWORK_METRICS_COLUMNS)].reverse();

    expect(schemaDrift(reversed, NETWORK_METRICS_COLUMNS)).toEqual({
      retyped: [],
      extra: [],
      missing: [],
      designatedOk: true,
    });
  });

  it("is not ok when a different column is the designated timestamp", () => {
    const columns = live(NETWORK_METRICS_COLUMNS).map((column) => ({
      ...column,
      designated: column.name === "source",
    }));

    expect(schemaDrift(columns, NETWORK_METRICS_COLUMNS).designatedOk).toBe(
      false
    );
  });

  it("is not ok when a different TIMESTAMP column is the designated one", () => {
    const columns = [
      ...live(NETWORK_METRICS_COLUMNS).map((column) => ({
        ...column,
        designated: false,
      })),
      { name: "created", type: "TIMESTAMP", designated: true },
    ];

    const drift = schemaDrift(columns, NETWORK_METRICS_COLUMNS);

    expect(drift.designatedOk).toBe(false);
    expect(needsRebuild(drift)).toBe(true);
  });

  it("is not ok when the table has no designated timestamp", () => {
    const columns = live(NETWORK_METRICS_COLUMNS).map((column) => ({
      ...column,
      designated: false,
    }));

    expect(schemaDrift(columns, NETWORK_METRICS_COLUMNS).designatedOk).toBe(
      false
    );
  });
});

describe("needsRebuild", () => {
  it("is true when another column is the designated timestamp", () => {
    const columns = live(NETWORK_METRICS_COLUMNS).map((column) => ({
      ...column,
      designated: column.name === "source",
    }));

    expect(needsRebuild(schemaDrift(columns, NETWORK_METRICS_COLUMNS))).toBe(
      true
    );
  });

  it("is true when the table has no designated timestamp", () => {
    const columns = live(NETWORK_METRICS_COLUMNS).map((column) => ({
      ...column,
      designated: false,
    }));

    expect(needsRebuild(schemaDrift(columns, NETWORK_METRICS_COLUMNS))).toBe(
      true
    );
  });
});

describe("describeDrift", () => {
  it("lists each difference", () => {
    const drift = schemaDrift(
      [
        ...withType("timestamp", "TIMESTAMP_NS"),
        { name: "note", type: "STRING", designated: false },
      ].filter((column) => column.name !== "isp"),
      NETWORK_METRICS_COLUMNS
    );

    expect(describeDrift(drift)).toEqual([
      "timestamp is TIMESTAMP_NS, expected TIMESTAMP",
      "the designated timestamp is not timestamp of type TIMESTAMP",
      "unexpected column note",
      "missing column isp",
    ]);
  });

  it("is empty when nothing drifted", () => {
    expect(
      describeDrift(
        schemaDrift(live(NETWORK_METRICS_COLUMNS), NETWORK_METRICS_COLUMNS)
      )
    ).toEqual([]);
  });
});

describe("rebuildCopySql", () => {
  const names = NETWORK_METRICS_COLUMNS.map((column) => column.name);

  it("casts every target column to its declared type, in target order", () => {
    const sql = rebuildCopySql(
      "t",
      "t__rebuild",
      NETWORK_METRICS_COLUMNS,
      names
    );

    expect(sql).toContain("INSERT INTO t__rebuild (timestamp, source, host,");
    expect(sql).toContain("cast(timestamp as TIMESTAMP)");
    expect(sql).toContain("cast(source as SYMBOL)");
    expect(sql).toContain("cast(isp as STRING)");
    expect(sql).toContain("cast(download_bandwidth as LONG)");
    expect(sql).toMatch(/FROM t$/);
  });

  it("selects a typed NULL for a column the source lacks", () => {
    const sql = rebuildCopySql(
      "t",
      "t__rebuild",
      NETWORK_METRICS_COLUMNS,
      names.filter((name) => name !== "isp")
    );

    expect(sql).toContain("cast(NULL as STRING)");
    expect(sql).not.toContain("cast(isp as");
  });
});

describe("rebuildCopySql exact output", () => {
  it("builds the whole statement", () => {
    expect(
      rebuildCopySql(
        "t",
        "t__rebuild",
        [
          { name: "timestamp", type: "TIMESTAMP" },
          { name: "host", type: "SYMBOL" },
          { name: "isp", type: "STRING" },
        ],
        ["timestamp", "host"]
      )
    ).toBe(
      "INSERT INTO t__rebuild (timestamp, host, isp) SELECT cast(timestamp as TIMESTAMP), cast(host as SYMBOL), cast(NULL as STRING) FROM t"
    );
  });
});
