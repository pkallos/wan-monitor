import { describe, expect, it } from "vitest";
import type { QueryStateParams } from "@/infrastructure/database/questdb/model";
import {
  buildQueryConnectivityStatus,
  buildQueryLiveConnectivity,
  buildQueryOutageRuns,
  buildQueryWindowUptime,
  type SqlQuerySpec,
} from "@/infrastructure/database/questdb/queries";

/**
 * QuestDB behaviours that no result can reveal, so they are pinned on the SQL
 * text: a CTE read twice runs twice, a column alias equal to a CTE name
 * silently drops rows, and a `timestamp(col)` subquery needs its ORDER BY to
 * be read in order.
 */

const TABLE = "network_metrics";
const state: QueryStateParams = {
  startTime: new Date("2024-01-01T00:00:00Z"),
  endTime: new Date("2024-01-02T00:00:00Z"),
  nowMs: Date.parse("2024-01-03T00:00:00Z"),
  intervalMs: 30_000,
  hosts: ["8.8.8.8", "1.1.1.1"],
};

const statements: readonly (readonly [string, SqlQuerySpec])[] = [
  ["outage runs", buildQueryOutageRuns(state, TABLE)],
  ...(["1m", "5m", "15m", "1h", "6h", "1d"] as const).map(
    (granularity) =>
      [
        `ribbon at ${granularity}`,
        buildQueryConnectivityStatus({ ...state, granularity }, TABLE),
      ] as const
  ),
  [
    "live",
    buildQueryLiveConnectivity(
      { nowMs: state.nowMs, intervalMs: state.intervalMs, hosts: state.hosts },
      TABLE
    ),
  ],
  [
    "window uptime",
    buildQueryWindowUptime(
      { ...state, windowStartTimes: [new Date("2023-12-30T00:00:00Z")] },
      TABLE
    ),
  ],
  ["any hosts", buildQueryOutageRuns({ ...state, hosts: [] }, TABLE)],
];

const cteNames = (query: string): string[] =>
  [...query.matchAll(/(?:^|\n|WITH\s)(\w+) AS \(/g)].map(
    (match) => match[1] ?? ""
  );

const readsOf = (query: string, name: string): number =>
  [...query.matchAll(new RegExp(`\\b(?:FROM|JOIN)\\s+\\(*\\s*${name}\\b`, "g"))]
    .length;

describe.each(statements)("%s", (_label, { query }) => {
  it("reads each CTE once, except holds, whose rows enter the events twice", () => {
    for (const name of cteNames(query)) {
      if (name === "holds") {
        continue;
      }
      const reads = readsOf(query, name);
      expect(reads, `${name} is read ${reads} times`).toBeLessThanOrEqual(1);
    }
  });

  it("defines states and reads it exactly once", () => {
    expect(cteNames(query)).toContain("states");
    expect(readsOf(query, "states")).toBe(1);
  });

  it("has no alias or column named like a CTE", () => {
    for (const name of cteNames(query)) {
      for (const match of query.matchAll(new RegExp(`\\b${name}\\b`, "g"))) {
        const index = match.index ?? 0;
        const before = query.slice(Math.max(0, index - 12), index);
        const after = query.slice(index + name.length, index + name.length + 5);
        const isDefinition = after.startsWith(" AS (");
        const isRead = /(?:FROM|JOIN)\s+\(*\s*$/.test(before);
        expect(
          isDefinition || isRead,
          `${name} appears outside a definition or a FROM: ...${before}${name}${after}`
        ).toBe(true);
      }
    }
  });

  it("orders every timestamp(col) subquery by that column", () => {
    for (const match of query.matchAll(/\)\s*timestamp\((\w+)\)/g)) {
      const index = match.index ?? 0;
      const inside = query.slice(Math.max(0, index - 60), index);
      expect(inside, `timestamp(${match[1]}) has no ORDER BY`).toMatch(
        new RegExp(`ORDER BY ${match[1]}\\s*$`)
      );
    }
  });
});

describe("read counts of holds", () => {
  it("reads holds twice for the state pipeline and a third time to pair outage hosts", () => {
    expect(readsOf(buildQueryOutageRuns(state, TABLE).query, "holds")).toBe(3);
    expect(
      readsOf(
        buildQueryConnectivityStatus({ ...state, granularity: "1h" }, TABLE)
          .query,
        "holds"
      )
    ).toBe(2);
  });
});
