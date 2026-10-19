import type { Granularity } from "@shared/api/routes/metrics";
import { Option } from "effect";
import { describe, expect, test } from "vitest";
import {
  Custom,
  granularityForSpeedtestRange,
  Preset,
} from "@/dashboard/dateRange";
import {
  CONNECTION_STATUS,
  coverageNote,
  describeFetchErrors,
  describeRange,
  lastSampleText,
  lastTestLabel,
  networkInfo,
  networkText,
  percentText,
  railStats,
  speedAveragesNote,
  speedCadenceText,
  unreportedRailStats,
} from "@/dashboard/overview";
import {
  rangeSummary,
  summaryResponse,
  withTimeZone,
} from "@/dashboard/testFixtures";

const NOW_MS = Date.parse("2026-01-01T12:00:00.000Z");
const THIRTY_SECONDS_AGO = Option.some(NOW_MS - 30_000);

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
      Option.some("Last checked 30 seconds ago")
    );
    expect(lastSampleText("down", THIRTY_SECONDS_AGO, NOW_MS)).toEqual(
      Option.some("Last checked 30 seconds ago")
    );
  });

  test("omits the line when a reachable status carries no sample time", () => {
    expect(lastSampleText("up", Option.none(), NOW_MS)).toEqual(Option.none());
  });

  test("says when a silent monitor last reported", () => {
    expect(
      lastSampleText("noInfo", Option.some(NOW_MS - 4 * 60 * 60 * 1000), NOW_MS)
    ).toEqual(Option.some("Last checked 4 hours ago"));
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

  test("names the dates of a custom range of whole days with 'to', the year once", () => {
    withTimeZone("UTC", () => {
      expect(
        describeRange(
          Custom({
            startTime: "2026-01-01T00:00:00.000Z",
            endTime: "2026-01-08T23:59:59.999Z",
          })
        )
      ).toBe("Jan 1 to Jan 8, 2026");
    });
  });

  test("names both years when a custom range crosses a year boundary", () => {
    withTimeZone("UTC", () => {
      expect(
        describeRange(
          Custom({
            startTime: "2025-12-28T00:00:00.000Z",
            endTime: "2026-01-03T23:59:59.999Z",
          })
        )
      ).toBe("Dec 28, 2025 to Jan 3, 2026");
    });
  });

  test("names a span brushed on a chart by its start and end times", () => {
    withTimeZone("UTC", () => {
      expect(
        describeRange(
          Custom({
            startTime: "2026-10-16T09:12:00.000Z",
            endTime: "2026-10-16T12:40:00.000Z",
          })
        )
      ).toBe("Oct 16, 9:12 AM to 12:40 PM");
    });
  });

  test("names the date of the end too when a brushed span crosses midnight", () => {
    withTimeZone("UTC", () => {
      expect(
        describeRange(
          Custom({
            startTime: "2026-10-16T22:00:00.000Z",
            endTime: "2026-10-17T02:30:00.000Z",
          })
        )
      ).toBe("Oct 16, 10:00 PM to Oct 17, 2:30 AM");
    });
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

describe("networkText", () => {
  test("names the ISP and its public IP in a phrase", () => {
    expect(
      networkText({
        isp: "TestISP",
        maybeExternalIp: Option.some("1.2.3.4"),
      })
    ).toBe("TestISP, public IP 1.2.3.4");
  });

  test("is just the ISP when the IP is unknown", () => {
    expect(
      networkText({ isp: "TestISP", maybeExternalIp: Option.none() })
    ).toBe("TestISP");
  });
});

describe("coverageNote", () => {
  const HOUR_SECONDS = 3600;
  const DAY_SECONDS = 86_400;

  test("says nothing when the monitor covered the whole range", () => {
    expect(coverageNote(100, DAY_SECONDS)).toEqual(Option.none());
  });

  test("gives the observed time in long words", () => {
    expect(coverageNote((23 / 24) * 100, 23 * HOUR_SECONDS)).toEqual(
      Option.some(
        "The monitor has data for 23 hours of this period, and uptime covers only that time."
      )
    );
  });

  test("works in minutes and days too", () => {
    expect(coverageNote(50, HOUR_SECONDS)).toEqual(
      Option.some(
        "The monitor has data for 1 hour of this period, and uptime covers only that time."
      )
    );
    expect(coverageNote(25, 7.5 * DAY_SECONDS)).toEqual(
      Option.some(
        "The monitor has data for 7 days 12 hours of this period, and uptime covers only that time."
      )
    );
  });

  test("reads the observed seconds, not a share of the range", () => {
    expect(coverageNote(50, 2 * HOUR_SECONDS)).toEqual(
      Option.some(
        "The monitor has data for 2 hours of this period, and uptime covers only that time."
      )
    );
  });

  test("says there is no data when nothing was covered", () => {
    expect(coverageNote(0, 0)).toEqual(
      Option.some("The monitor has no data for this period.")
    );
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

describe("lastTestLabel", () => {
  const AT = "2026-01-01T11:00:00.000Z";
  const none = Option.none<Granularity>();

  test("names the newest test's time, speeds and server as a sentence", () => {
    withTimeZone("UTC", () => {
      expect(
        lastTestLabel(
          [
            {
              timestamp: "2026-01-01T09:00:00.000Z",
              download_speed: 1,
              upload_speed: 1,
              server_location: "Old",
            },
            {
              timestamp: AT,
              download_speed: 100.4,
              upload_speed: 10,
              server_location: "Fremont, CA",
            },
          ],
          none
        )
      ).toEqual(
        Option.some(
          "Last test, Jan 1 at 11:00 AM: 100 Mbps down, 10.0 Mbps up (Fremont, CA)."
        )
      );
    });
  });

  test("drops the server clause when the test recorded none", () => {
    withTimeZone("UTC", () => {
      expect(
        lastTestLabel(
          [{ timestamp: AT, download_speed: 50, upload_speed: 5 }],
          none
        )
      ).toEqual(
        Option.some(
          "Last test, Jan 1 at 11:00 AM: 50.0 Mbps down, 5.0 Mbps up."
        )
      );
    });
  });

  test("says which measurement a test is missing instead of printing a dash", () => {
    withTimeZone("UTC", () => {
      expect(
        lastTestLabel([{ timestamp: AT, download_speed: 50 }], none)
      ).toEqual(
        Option.some(
          "Last test, Jan 1 at 11:00 AM: 50.0 Mbps down, no upload reading."
        )
      );
    });
  });

  test("keeps a genuine zero reading distinct from a missing one", () => {
    withTimeZone("UTC", () => {
      expect(
        lastTestLabel(
          [{ timestamp: AT, download_speed: 0, upload_speed: 0 }],
          none
        )
      ).toEqual(
        Option.some("Last test, Jan 1 at 11:00 AM: 0.0 Mbps down, 0.0 Mbps up.")
      );
    });
  });

  test("is absent with no tests", () => {
    expect(lastTestLabel([], none)).toEqual(Option.none());
    expect(lastTestLabel([], Option.some("1h"))).toEqual(Option.none());
  });

  test.each([
    ["1m", "Latest 1-minute average"],
    ["5m", "Latest 5-minute average"],
    ["15m", "Latest 15-minute average"],
    ["1h", "Latest hourly average"],
    ["6h", "Latest 6-hour average"],
  ] as const)("calls a %s bucket the %s, never a test", (bucket, lead) => {
    withTimeZone("UTC", () => {
      expect(
        lastTestLabel(
          [
            {
              timestamp: AT,
              download_speed: 100,
              upload_speed: 10,
              server_location: "Fremont, CA",
            },
          ],
          Option.some(bucket)
        )
      ).toEqual(
        Option.some(
          `${lead}, Jan 1 at 11:00 AM: 100 Mbps down, 10.0 Mbps up (Fremont, CA).`
        )
      );
    });
  });

  test("names a daily bucket by its UTC day, with no time of day", () => {
    withTimeZone("America/Los_Angeles", () => {
      expect(
        lastTestLabel(
          [
            {
              timestamp: "2026-01-02T00:00:00.000Z",
              download_speed: 100,
              upload_speed: 10,
            },
          ],
          Option.some("1d")
        )
      ).toEqual(
        Option.some("Latest daily average, Jan 2: 100 Mbps down, 10.0 Mbps up.")
      );
    });
  });
});

describe("speedCadenceText", () => {
  test("says how often a test runs, in words", () => {
    expect(speedCadenceText(3600)).toBe("A test runs every hour.");
    expect(speedCadenceText(21_600)).toBe("A test runs every 6 hours.");
    expect(speedCadenceText(1800)).toBe("A test runs every 30 minutes.");
  });
});

describe("speedAveragesNote", () => {
  test.each([
    ["1h", "Over 7 days or more, each point averages an hour of tests."],
    ["6h", "Over 7 days or more, each point averages 6 hours of tests."],
    ["1d", "Over 7 days or more, each point averages a day of tests."],
  ] as const)("says what a %s bucket holds", (bucket, expected) => {
    expect(speedAveragesNote(bucket)).toBe(expected);
  });

  test("takes its threshold from the one that decides when tests are bucketed", () => {
    const window = (days: number) => ({
      startTime: new Date(0).toISOString(),
      endTime: new Date(days * 86_400_000).toISOString(),
    });

    expect(speedAveragesNote("1h")).toContain("7 days");
    expect(granularityForSpeedtestRange(window(7))).toBeDefined();
    expect(granularityForSpeedtestRange(window(6.9))).toBeUndefined();
  });
});

describe("unreportedRailStats", () => {
  test("names the same figures as a reported rail, so a failed summary keeps its layout", () => {
    expect(
      unreportedRailStats.map(({ key, label, unit }) => [key, label, unit])
    ).toEqual(
      railStats(summaryResponse()).map(({ key, label, unit }) => [
        key,
        label,
        unit,
      ])
    );
  });

  test("dashes every figure, with no claim about tests run", () => {
    expect(unreportedRailStats.map((stat) => stat.value)).toEqual(
      Array(5).fill("-")
    );
    expect(unreportedRailStats.map((stat) => stat.sub)).toEqual([
      "95th percentile -",
      "Averaged over all pings",
      "Averaged over all pings",
      "Median",
      "Median",
    ]);
  });
});

describe("railStats", () => {
  const stats = (summary = summaryResponse()) => railStats(summary);
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
      sub: "95th percentile 31.8 ms",
    });
  });

  test("reports loss and jitter as averages with their own units", () => {
    expect(byKey().loss).toMatchObject({
      value: "0.50",
      unit: "%",
      sub: "Averaged over all pings",
    });
    expect(byKey().jitter).toMatchObject({
      value: "2.1",
      unit: "ms",
      sub: "Averaged over all pings",
    });
  });

  test("shows the median speed with the number of tests behind it", () => {
    expect(byKey().download).toMatchObject({
      value: "941",
      unit: "Mbps",
      sub: "Median of 24 tests",
    });
    expect(byKey().upload).toMatchObject({
      value: "917",
      sub: "Median of 24 tests",
    });
  });

  test("uses the singular for a single test", () => {
    const one = summaryResponse({
      speed: { ...summaryResponse().speed, count: 1 },
    });

    expect(byKey(one).download.sub).toBe("Median of 1 test");
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

    expect(byKey(quiet).latency).toMatchObject({
      value: "-",
      sub: "95th percentile -",
    });
  });

  test("keeps a genuine zero loss distinct from no data", () => {
    const clean = summaryResponse({
      range: rangeSummary({ avgPacketLoss: 0 }),
    });

    expect(byKey(clean).loss.value).toBe("0.00");
  });
});
