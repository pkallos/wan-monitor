import { Option } from "effect";
import { describe, expect, test } from "vitest";
import { Custom, Preset } from "@/dashboard/dateRange";
import { summaryDeltas } from "@/dashboard/deltas";
import {
  CONNECTION_STATUS,
  describeFetchErrors,
  describeRange,
  formatDurationAgo,
  lastSampleText,
  lastTestLabel,
  latestSpeedPair,
  networkInfo,
  percentText,
  railStats,
  rangeTag,
  rangeTitle,
  unreportedRailStats,
} from "@/dashboard/overview";
import { rangeSummary, summaryResponse } from "@/dashboard/testFixtures";

const NOW_MS = Date.parse("2026-01-01T12:00:00.000Z");
const THIRTY_SECONDS_AGO = Option.some(NOW_MS - 30_000);

const CUSTOM_RANGE = Custom({
  startTime: "2026-01-01T00:00:00.000Z",
  endTime: "2026-01-08T00:00:00.000Z",
});

describe("CONNECTION_STATUS", () => {
  test("uses the live vocabulary for the status word", () => {
    expect(CONNECTION_STATUS.up.label).toBe("Online");
    expect(CONNECTION_STATUS.degraded.label).toBe("Degraded");
    expect(CONNECTION_STATUS.down.label).toBe("Offline");
    expect(CONNECTION_STATUS.noInfo.label).toBe("No data");
    expect(CONNECTION_STATUS.checking.label).toBe("Checking…");
  });
});

describe("lastSampleText", () => {
  test("says how long ago a live status was sampled", () => {
    expect(lastSampleText("up", THIRTY_SECONDS_AGO, NOW_MS)).toEqual(
      Option.some("Last sample 30s ago")
    );
    expect(lastSampleText("down", THIRTY_SECONDS_AGO, NOW_MS)).toEqual(
      Option.some("Last sample 30s ago")
    );
  });

  test("omits the line when a reachable cycle carries no sample time", () => {
    expect(lastSampleText("up", Option.none(), NOW_MS)).toEqual(Option.none());
  });

  test("says when a silent monitor last reported", () => {
    expect(
      lastSampleText("noInfo", Option.some(NOW_MS - 4 * 60 * 60 * 1000), NOW_MS)
    ).toEqual(Option.some("Last sample 4h ago"));
  });

  test("says there are no samples when nothing was ever recorded", () => {
    expect(lastSampleText("noInfo", Option.none(), NOW_MS)).toEqual(
      Option.some("No samples yet")
    );
  });

  test("has nothing to say while still checking", () => {
    expect(lastSampleText("checking", Option.none(), NOW_MS)).toEqual(
      Option.none()
    );
  });
});

describe("describeRange", () => {
  test.each([
    ["last1h", "the last hour"],
    ["last24h", "the last 24 hours"],
    ["last7d", "the last 7 days"],
    ["last30d", "the last 30 days"],
    ["mtd", "the month to date"],
    ["qtd", "the quarter to date"],
    ["ytd", "the year to date"],
    ["last12m", "the last 12 months"],
    ["allTime", "all time"],
  ] as const)("phrases the %s preset as %s", (preset, phrase) => {
    expect(describeRange(Preset({ preset }))).toBe(phrase);
  });

  test("names the dates of a custom range", () => {
    expect(describeRange(CUSTOM_RANGE)).toMatch(/Jan 1.* - .*Jan 8/);
  });
});

describe("rangeTitle and rangeTag", () => {
  test.each([
    ["last1h", "1 hour", "1h"],
    ["last24h", "24 hours", "24h"],
    ["last7d", "7 days", "7d"],
    ["last30d", "30 days", "30d"],
    ["mtd", "Month to date", "MTD"],
    ["qtd", "Quarter to date", "QTD"],
    ["ytd", "Year to date", "YTD"],
    ["last12m", "12 months", "12m"],
    ["allTime", "All time", "all time"],
  ] as const)("names the %s preset %s, tagged %s", (preset, title, tag) => {
    expect(rangeTitle(Preset({ preset }))).toBe(title);
    expect(rangeTag(Preset({ preset }))).toEqual(Option.some(tag));
  });

  test("titles a custom range by its dates and gives it no tag", () => {
    expect(rangeTitle(CUSTOM_RANGE)).toBe(describeRange(CUSTOM_RANGE));
    expect(rangeTag(CUSTOM_RANGE)).toEqual(Option.none());
  });
});

describe("percentText", () => {
  test("keeps two decimals", () => {
    expect(percentText(99.414)).toBe("99.41");
    expect(percentText(100)).toBe("100.00");
  });

  test("keeps a genuine zero distinct from no data", () => {
    expect(percentText(0)).toBe("0.00");
    expect(percentText(null)).toBe("-");
  });
});

describe("latestSpeedPair", () => {
  test("reports the most recent test's download and upload together", () => {
    expect(
      latestSpeedPair([
        {
          timestamp: "2026-01-01T11:00:00.000Z",
          download_speed: 100,
          upload_speed: 10,
        },
        {
          timestamp: "2026-01-01T11:59:30.000Z",
          download_speed: 123.44,
          upload_speed: 12.3,
        },
      ])
    ).toBe("123 / 12.3");
  });

  test("shows a placeholder with no tests", () => {
    expect(latestSpeedPair([])).toBe("-");
  });

  test("renders each half of the pair independently when one measurement is missing", () => {
    expect(
      latestSpeedPair([
        { timestamp: "2026-01-01T11:59:30.000Z", download_speed: 50 },
      ])
    ).toBe("50.0 / -");
  });

  test("rounds triple-digit speeds to whole numbers and keeps one decimal below 100", () => {
    expect(
      latestSpeedPair([
        {
          timestamp: "2026-01-01T11:59:30.000Z",
          download_speed: 941.4,
          upload_speed: 99.94,
        },
      ])
    ).toBe("941 / 99.9");
  });

  test("keeps a genuine zero reading distinct from a missing one", () => {
    expect(
      latestSpeedPair([
        {
          timestamp: "2026-01-01T11:59:30.000Z",
          download_speed: 0,
          upload_speed: 0,
        },
      ])
    ).toBe("0.0 / 0.0");
  });
});

describe("networkInfo", () => {
  test("reports the most recent sample's ISP and external IP", () => {
    expect(
      networkInfo([
        { isp: "Comcast", external_ip: "1.2.3.4" },
        { isp: "Old ISP", external_ip: "5.6.7.8" },
      ])
    ).toEqual({ isp: "Comcast", maybeExternalIp: Option.some("1.2.3.4") });
  });

  test("falls back to ISP unknown with no external IP when the field is missing", () => {
    expect(networkInfo([{ isp: undefined, external_ip: undefined }])).toEqual({
      isp: "ISP unknown",
      maybeExternalIp: Option.none(),
    });
  });

  test("falls back to ISP unknown with no samples", () => {
    expect(networkInfo([])).toEqual({
      isp: "ISP unknown",
      maybeExternalIp: Option.none(),
    });
  });

  test("skips a newer sample that carries no ISP", () => {
    // A failed speed test records a row without ISP details. The last known
    // good reading is still the truth about which network this is.
    expect(
      networkInfo([
        { isp: undefined, external_ip: undefined },
        { isp: "Comcast", external_ip: "1.2.3.4" },
      ])
    ).toEqual({ isp: "Comcast", maybeExternalIp: Option.some("1.2.3.4") });
  });

  test("skips a newer sample whose ISP is blank", () => {
    expect(
      networkInfo([
        { isp: "", external_ip: undefined },
        { isp: "Comcast", external_ip: "1.2.3.4" },
      ])
    ).toEqual({ isp: "Comcast", maybeExternalIp: Option.some("1.2.3.4") });
  });

  test("falls back to ISP unknown when no sample has one", () => {
    expect(
      networkInfo([
        { isp: undefined, external_ip: "1.2.3.4" },
        { isp: undefined, external_ip: "5.6.7.8" },
      ])
    ).toEqual({ isp: "ISP unknown", maybeExternalIp: Option.none() });
  });
});

describe("describeFetchErrors", () => {
  test("is empty when nothing failed", () => {
    expect(
      describeFetchErrors([
        { source: "Metrics", maybeError: Option.none() },
        { source: "Speed tests", maybeError: Option.none() },
      ])
    ).toEqual([]);
  });

  test("names the failing source beside its error", () => {
    expect(
      describeFetchErrors([
        { source: "Metrics", maybeError: Option.some("network error") },
        { source: "Speed tests", maybeError: Option.none() },
      ])
    ).toEqual(["Metrics: network error"]);
  });

  test("merges sources that failed with the same message into one line", () => {
    expect(
      describeFetchErrors([
        { source: "Metrics", maybeError: Option.some("db down") },
        { source: "Speed tests", maybeError: Option.some("db down") },
        { source: "Availability", maybeError: Option.some("db down") },
      ])
    ).toEqual(["Metrics, Speed tests, Availability: db down"]);
  });

  test("keeps distinct errors on their own lines, in first-seen order", () => {
    expect(
      describeFetchErrors([
        { source: "Metrics", maybeError: Option.some("timeout") },
        { source: "Speed tests", maybeError: Option.some("db down") },
        { source: "Availability", maybeError: Option.some("timeout") },
      ])
    ).toEqual(["Metrics, Availability: timeout", "Speed tests: db down"]);
  });
});

describe("formatDurationAgo", () => {
  test.each([
    [5_000, "5s ago"],
    [59_999, "59s ago"],
    [60_000, "1m ago"],
    [3_599_000, "59m ago"],
    [3_600_000, "1h ago"],
    [86_400_000, "1d ago"],
  ])("renders %ims as %s", (elapsedMs, expected) => {
    expect(formatDurationAgo(elapsedMs)).toBe(expected);
  });
});

describe("lastTestLabel", () => {
  const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };

  test("names the newest test's time and server", () => {
    const label = lastTestLabel([
      { timestamp: "2026-01-01T09:00:00.000Z", server_location: "Old" },
      { timestamp: "2026-01-01T11:00:00.000Z", server_location: "Fremont, CA" },
    ]);

    expect(label).toEqual(
      Option.some(
        `Last test · ${new Date("2026-01-01T11:00:00.000Z").toLocaleString([], TIME_OPTIONS)} · Fremont, CA`
      )
    );
  });

  test("drops the server clause when the test recorded none", () => {
    expect(lastTestLabel([{ timestamp: "2026-01-01T11:00:00.000Z" }])).toEqual(
      Option.some(
        `Last test · ${new Date("2026-01-01T11:00:00.000Z").toLocaleString([], TIME_OPTIONS)}`
      )
    );
  });

  test("is absent with no tests", () => {
    expect(lastTestLabel([])).toEqual(Option.none());
  });
});

describe("unreportedRailStats", () => {
  test("names the same figures as a reported rail, so a failed summary keeps its layout", () => {
    expect(
      unreportedRailStats.map(({ key, label, unit }) => [key, label, unit])
    ).toEqual(
      railStats(summaryResponse(), Option.none()).map(
        ({ key, label, unit }) => [key, label, unit]
      )
    );
  });

  test("dashes every figure, with no change and no claim about tests run", () => {
    expect(unreportedRailStats.map((stat) => stat.value)).toEqual(
      Array(5).fill("-")
    );
    expect(unreportedRailStats.map((stat) => stat.delta)).toEqual(
      Array(5).fill(Option.none())
    );
    expect(unreportedRailStats.map((stat) => stat.sub)).toEqual([
      "p95 -",
      "average",
      "average",
      "median",
      "median",
    ]);
  });
});

describe("railStats", () => {
  const stats = (summary = summaryResponse()) =>
    railStats(
      summary,
      Option.some(summaryDeltas(summary.range, summary.previous))
    );
  const byKey = (summary = summaryResponse()) =>
    Object.fromEntries(stats(summary).map((stat) => [stat.key, stat]));

  test("lists latency, loss, jitter, download and upload in that order", () => {
    expect(stats().map((stat) => stat.label)).toEqual([
      "Latency p50",
      "Packet loss",
      "Jitter",
      "Download",
      "Upload",
    ]);
  });

  test("headlines the median latency and names the 95th percentile", () => {
    expect(byKey().latency).toMatchObject({
      value: "14.2",
      unit: "ms",
      sub: "p95 31.8 ms",
    });
  });

  test("reports loss and jitter as averages with their own units", () => {
    expect(byKey().loss).toMatchObject({
      value: "0.50",
      unit: "%",
      sub: "average",
    });
    expect(byKey().jitter).toMatchObject({
      value: "2.1",
      unit: "ms",
      sub: "average",
    });
  });

  test("carries the change since the previous window for latency, loss and jitter only", () => {
    const { latency, loss, jitter, download, upload } = byKey();

    expect(Option.isSome(latency.delta)).toBe(true);
    expect(Option.isSome(loss.delta)).toBe(true);
    expect(Option.isSome(jitter.delta)).toBe(true);
    expect(download.delta).toEqual(Option.none());
    expect(upload.delta).toEqual(Option.none());
  });

  test("shows the median speed with the number of tests behind it", () => {
    expect(byKey().download).toMatchObject({
      value: "941",
      unit: "Mbps",
      sub: "median · 24 tests",
    });
    expect(byKey().upload).toMatchObject({
      value: "917",
      sub: "median · 24 tests",
    });
  });

  test("uses the singular for a single test", () => {
    const one = summaryResponse({
      speed: { ...summaryResponse().speed, count: 1 },
    });

    expect(byKey(one).download.sub).toBe("median · 1 test");
  });

  test("says so when the range has no speed tests", () => {
    const none = summaryResponse({
      speed: {
        ...summaryResponse().speed,
        downloadMedian: null,
        uploadMedian: null,
        count: 0,
      },
    });

    expect(byKey(none).download).toMatchObject({
      value: "-",
      sub: "No tests in this range.",
    });
  });

  test("dashes a range that recorded no latency", () => {
    const quiet = summaryResponse({
      range: rangeSummary({ latencyP50: null, latencyP95: null }),
    });

    expect(byKey(quiet).latency).toMatchObject({ value: "-", sub: "p95 -" });
  });

  test("keeps a genuine zero loss distinct from no data", () => {
    const clean = summaryResponse({
      range: rangeSummary({ avgPacketLoss: 0 }),
    });

    expect(byKey(clean).loss.value).toBe("0.00");
  });

  test("has no change to report without deltas", () => {
    expect(
      railStats(summaryResponse(), Option.none()).map((stat) => stat.delta)
    ).toEqual(Array(5).fill(Option.none()));
  });
});
