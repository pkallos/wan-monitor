import {
  buildAddColumnSql,
  buildCreateTableSql,
  missingColumns,
  NETWORK_METRICS_COLUMNS,
  NETWORK_METRICS_TABLE,
} from "@shared/db-schema";
import { describe, expect, it } from "vitest";

const allColumnNames = NETWORK_METRICS_COLUMNS.map((column) => column.name);

describe("buildCreateTableSql", () => {
  const sql = buildCreateTableSql();

  it("creates the table idempotently with WAL + daily partitioning", () => {
    expect(sql).toContain(
      `CREATE TABLE IF NOT EXISTS ${NETWORK_METRICS_TABLE}`
    );
    expect(sql).toContain("TIMESTAMP(timestamp)");
    expect(sql).toContain("PARTITION BY DAY WAL");
  });

  it("declares every canonical column with its type", () => {
    for (const column of NETWORK_METRICS_COLUMNS) {
      expect(sql).toContain(`${column.name} ${column.type}`);
    }
  });

  it("includes the speedtest columns the queries read", () => {
    expect(allColumnNames).toContain("download_bandwidth");
    expect(allColumnNames).toContain("upload_bandwidth");
    expect(allColumnNames).toContain("server_location");
    expect(allColumnNames).toContain("isp");
  });

  it("targets a custom table when provided", () => {
    const custom = buildCreateTableSql("network_metrics_test_3");

    expect(custom).toContain(
      "CREATE TABLE IF NOT EXISTS network_metrics_test_3"
    );
    expect(custom).not.toContain("IF NOT EXISTS network_metrics (");
  });

  it("declares the given columns when provided", () => {
    const custom = buildCreateTableSql("custom", [
      { name: "timestamp", type: "TIMESTAMP_NS" },
      { name: "host", type: "SYMBOL" },
    ]);

    expect(custom).toContain("timestamp TIMESTAMP_NS,\n  host SYMBOL\n)");
    expect(custom).not.toContain("latency");
  });
});

describe("buildAddColumnSql", () => {
  it("builds a non-destructive ALTER ADD COLUMN statement", () => {
    expect(buildAddColumnSql({ name: "isp", type: "STRING" })).toBe(
      `ALTER TABLE ${NETWORK_METRICS_TABLE} ADD COLUMN isp STRING;`
    );
  });

  it("targets a custom table when provided", () => {
    expect(
      buildAddColumnSql(
        { name: "isp", type: "STRING" },
        "network_metrics_test_3"
      )
    ).toBe("ALTER TABLE network_metrics_test_3 ADD COLUMN isp STRING;");
  });
});

describe("missingColumns", () => {
  it("returns nothing when all canonical columns exist", () => {
    expect(missingColumns(allColumnNames)).toEqual([]);
  });

  it("returns only the canonical columns that are absent, in canonical order", () => {
    const existing = allColumnNames.filter(
      (name) => name !== "isp" && name !== "latency"
    );

    expect(missingColumns(existing).map((column) => column.name)).toEqual([
      "latency",
      "isp",
    ]);
  });

  it("checks against the columns it is given", () => {
    const snapshot = [
      { name: "timestamp", type: "TIMESTAMP" },
      { name: "note", type: "STRING" },
    ];

    expect(missingColumns(["timestamp"], snapshot)).toEqual([
      { name: "note", type: "STRING" },
    ]);
  });
});
