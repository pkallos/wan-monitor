import { describe, expect, it } from "@effect/vitest";
import { NETWORK_METRICS_COLUMNS } from "@wan-monitor/shared/db-schema";
import {
  digestGroupsSql,
  digestMismatches,
  digestTotalsSql,
  type TableDigest,
  toDigest,
} from "@/infrastructure/database/questdb/migrations/digest";

const groupColumns = ["source", "host"];

const totalsRow = {
  row_count: "4",
  min_timestamp: "1000",
  max_timestamp: "4000",
  distinct_timestamp: "4",
  residue_timestamp: "2000",
  nn_latency: "3",
  approx_sum_latency: 60,
  sum_download_bandwidth: "300",
  len_isp: "12",
};

const digestOf = (
  totals: Record<string, unknown> = {},
  groups: Record<string, number> = { '["ping","8.8.8.8"]': 4 }
): TableDigest => ({
  totals: toDigest({ ...totalsRow, ...totals }, [], groupColumns).totals,
  groups,
});

describe("digestTotalsSql", () => {
  const sql = digestTotalsSql("metrics", NETWORK_METRICS_COLUMNS);

  it("counts rows and every column's non-null values", () => {
    expect(sql).toContain("count() AS row_count");
    for (const { name } of NETWORK_METRICS_COLUMNS) {
      expect(sql).toContain(`count(${name}) AS nn_${name}`);
    }
  });

  it("reads timestamps at microseconds whatever the column's precision", () => {
    expect(sql).toContain(
      "cast(cast(min(timestamp) as timestamp) as long) AS min_timestamp"
    );
    expect(sql).toContain(
      "cast(cast(max(timestamp) as timestamp) as long) AS max_timestamp"
    );
    expect(sql).toContain("count_distinct(timestamp) AS distinct_timestamp");
    expect(sql).toContain(
      "sum(cast(cast(timestamp as timestamp) as long) % 1000003) AS residue_timestamp"
    );
  });

  it("sums LONG and DOUBLE columns and the length of string-like ones", () => {
    expect(sql).toContain("sum(download_bandwidth) AS sum_download_bandwidth");
    expect(sql).toContain("sum(latency) AS approx_sum_latency");
    expect(sql).toContain("sum(length(cast(isp as varchar))) AS len_isp");
    expect(sql).toContain("sum(length(cast(source as varchar))) AS len_source");
    expect(sql).toMatch(/FROM metrics$/);
  });

  it("covers only the columns it is given", () => {
    const narrow = digestTotalsSql("metrics", [
      { name: "timestamp", type: "TIMESTAMP" },
      { name: "host", type: "SYMBOL" },
    ]);

    expect(narrow).not.toContain("latency");
    expect(narrow).toContain("len_host");
  });
});

describe("digestGroupsSql", () => {
  it("counts rows per group", () => {
    expect(digestGroupsSql("metrics", groupColumns)).toBe(
      "SELECT source, host, count() AS group_count FROM metrics GROUP BY source, host"
    );
  });
});

describe("toDigest", () => {
  it("keys groups by their values, with NULL as null", () => {
    const digest = toDigest(
      totalsRow,
      [
        { source: "ping", host: "8.8.8.8", group_count: "3" },
        { source: "speedtest", host: null, group_count: "1" },
      ],
      groupColumns
    );

    expect(digest.groups).toEqual({
      '["ping","8.8.8.8"]': 3,
      '["speedtest",null]': 1,
    });
  });
});

describe("digestMismatches", () => {
  it("accepts identical digests", () => {
    expect(digestMismatches(digestOf(), digestOf())).toEqual([]);
  });

  it("reports a differing row count", () => {
    expect(digestMismatches(digestOf(), digestOf({ row_count: "3" }))).toEqual([
      "row_count: 4 in source, 3 in copy",
    ]);
  });

  it("names the two sides with the given labels", () => {
    expect(
      digestMismatches(digestOf(), digestOf({ row_count: "3" }), [
        "before",
        "after",
      ])
    ).toEqual(["row_count: 4 in before, 3 in after"]);
  });

  it("reports a value present on one side only", () => {
    expect(
      digestMismatches(digestOf(), digestOf({ min_timestamp: null }))
    ).toEqual(["min_timestamp: 1000 in source, null in copy"]);
  });

  it("accepts a DOUBLE sum within a relative 1e-9", () => {
    expect(
      digestMismatches(
        digestOf({ approx_sum_latency: 1_000_000 }),
        digestOf({ approx_sum_latency: 1_000_000.0005 })
      )
    ).toEqual([]);
  });

  it("rejects a DOUBLE sum outside a relative 1e-9", () => {
    expect(
      digestMismatches(
        digestOf({ approx_sum_latency: 1_000_000 }),
        digestOf({ approx_sum_latency: 1_000_000.01 })
      )
    ).toEqual(["approx_sum_latency: 1000000 in source, 1000000.01 in copy"]);
  });

  it("accepts equal DOUBLE sums of exactly zero", () => {
    expect(
      digestMismatches(
        digestOf({ approx_sum_latency: 0 }),
        digestOf({ approx_sum_latency: 0 })
      )
    ).toEqual([]);
  });

  it("accepts equal non-zero DOUBLE sums", () => {
    expect(
      digestMismatches(
        digestOf({ approx_sum_latency: 123.456 }),
        digestOf({ approx_sum_latency: 123.456 })
      )
    ).toEqual([]);
  });

  it("compares LONG sums exactly", () => {
    expect(
      digestMismatches(
        digestOf({ sum_download_bandwidth: "9007199254740993" }),
        digestOf({ sum_download_bandwidth: "9007199254740992" })
      )
    ).toEqual([
      "sum_download_bandwidth: 9007199254740993 in source, 9007199254740992 in copy",
    ]);
  });

  it("reports a differing string length sum", () => {
    expect(digestMismatches(digestOf(), digestOf({ len_isp: "11" }))).toEqual([
      "len_isp: 12 in source, 11 in copy",
    ]);
  });

  it("reports a group whose row count differs or is absent", () => {
    expect(
      digestMismatches(
        digestOf({}, { '["ping","8.8.8.8"]': 3, '["ping","1.1.1.1"]': 1 }),
        digestOf({}, { '["ping","8.8.8.8"]': 2 })
      )
    ).toEqual([
      'rows for ["ping","8.8.8.8"]: 3 in source, 2 in copy',
      'rows for ["ping","1.1.1.1"]: 1 in source, 0 in copy',
    ]);
  });

  it("reports a timestamp moved by a microsecond even when the range and count are unchanged", () => {
    expect(
      digestMismatches(digestOf(), digestOf({ residue_timestamp: "2001" }))
    ).toEqual(["residue_timestamp: 2000 in source, 2001 in copy"]);
  });

  it("accepts two empty tables", () => {
    const empty = toDigest(
      {
        row_count: "0",
        min_timestamp: null,
        max_timestamp: null,
        approx_sum_latency: null,
        len_isp: null,
      },
      [],
      groupColumns
    );

    expect(digestMismatches(empty, empty)).toEqual([]);
  });

  it("reports a figure only one side has, whichever side it is", () => {
    const withExtra = digestOf({ nn_isp: "3" });

    expect(digestMismatches(withExtra, digestOf())).toEqual([
      "nn_isp: 3 in source, null in copy",
    ]);
    expect(digestMismatches(digestOf(), withExtra)).toEqual([
      "nn_isp: null in source, 3 in copy",
    ]);
  });

  it("reports a group that exists only in the copy", () => {
    expect(
      digestMismatches(
        digestOf({}, { '["ping","8.8.8.8"]': 4 }),
        digestOf({}, { '["ping","8.8.8.8"]': 4, '["ping","1.1.1.1"]': 1 })
      )
    ).toEqual(['rows for ["ping","1.1.1.1"]: 0 in source, 1 in copy']);
  });
});
