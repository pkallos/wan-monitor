import { Option } from "effect";
import { describe, expect, test } from "vitest";
import { Custom, Preset } from "@/dashboard/dateRange";
import {
  availabilityFigure,
  CONNECTION_SUMMARIES,
  describeFetchErrors,
  describeRange,
  formatDurationAgo,
  jitterFigure,
  lastSampleText,
  lastTestLabel,
  latencyFigure,
  networkInfo,
  packetLossFigure,
  speedFigure,
  uptimeSummary,
} from "@/dashboard/overview";

const NOW_MS = Date.parse("2026-01-01T12:00:00.000Z");
const THIRTY_SECONDS_AGO = Option.some(NOW_MS - 30_000);

describe("CONNECTION_SUMMARIES", () => {
  test("states each live status as a plain sentence", () => {
    expect(CONNECTION_SUMMARIES.up.headline).toBe("Connection is healthy.");
    expect(CONNECTION_SUMMARIES.degraded.headline).toBe(
      "Connection is degraded."
    );
    expect(CONNECTION_SUMMARIES.down.headline).toBe("Connection is down.");
    expect(CONNECTION_SUMMARIES.noInfo.headline).toBe("No recent data.");
    expect(CONNECTION_SUMMARIES.checking.headline).toBe("Checking connection…");
  });

  test("keeps the reachability vocabulary for the status word", () => {
    expect(CONNECTION_SUMMARIES.up.label).toBe("Online");
    expect(CONNECTION_SUMMARIES.degraded.label).toBe("Degraded");
    expect(CONNECTION_SUMMARIES.down.label).toBe("Offline");
    expect(CONNECTION_SUMMARIES.noInfo.label).toBe("No Data");
  });

  // A quiet monitor and a down link are different facts, so noInfo must never
  // borrow the red treatment an outage gets.
  test("tones an outage as an error and a silent monitor as neutral", () => {
    expect(CONNECTION_SUMMARIES.down.tone).toBe("error");
    expect(CONNECTION_SUMMARIES.noInfo.tone).toBe("neutral");
    expect(CONNECTION_SUMMARIES.checking.tone).toBe("neutral");
    expect(CONNECTION_SUMMARIES.up.tone).toBe("good");
    expect(CONNECTION_SUMMARIES.degraded.tone).toBe("warning");
  });
});

describe("lastSampleText", () => {
  test("says how long ago a live status was sampled", () => {
    expect(lastSampleText("up", THIRTY_SECONDS_AGO, NOW_MS)).toEqual(
      Option.some("last sample 30s ago")
    );
    expect(lastSampleText("down", THIRTY_SECONDS_AGO, NOW_MS)).toEqual(
      Option.some("last sample 30s ago")
    );
  });

  test("omits the clause when a reachable cycle carries no sample time", () => {
    expect(lastSampleText("up", Option.none(), NOW_MS)).toEqual(Option.none());
  });

  test("says when a silent monitor last reported", () => {
    expect(
      lastSampleText("noInfo", Option.some(NOW_MS - 4 * 60 * 60 * 1000), NOW_MS)
    ).toEqual(Option.some("last seen 4h ago"));
  });

  test("says there is no monitoring data when nothing was ever recorded", () => {
    expect(lastSampleText("noInfo", Option.none(), NOW_MS)).toEqual(
      Option.some("no monitoring data")
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

  test("falls back to a neutral phrase for a custom range", () => {
    expect(
      describeRange(
        Custom({
          startTime: "2026-01-01T00:00:00.000Z",
          endTime: "2026-01-08T00:00:00.000Z",
        })
      )
    ).toBe("the selected range");
  });
});

describe("uptimeSummary", () => {
  test("reports uptime with one decimal over the range", () => {
    expect(uptimeSummary(Option.some(99.64), "the last 24 hours")).toBe(
      "99.6% uptime over the last 24 hours."
    );
  });

  test("says so when the window held no ping cycles, rather than claiming 0%", () => {
    expect(uptimeSummary(Option.none(), "the last 24 hours")).toBe(
      "No uptime data for this period."
    );
  });
});

describe("availabilityFigure", () => {
  const points = [
    { downPercentage: 0 },
    { downPercentage: 40 },
    { downPercentage: 100 },
  ];

  test("reports availability (up or degraded), not uptime", () => {
    const figure = availabilityFigure(Option.some(99.64), points);

    expect(figure.label).toBe("Availability");
    expect(figure.value).toBe("99.6");
    expect(figure.unit).toBe("%");
    expect(figure.caption).toBe("up or degraded");
  });

  test("plots the share of each bucket that was reachable", () => {
    expect(availabilityFigure(Option.some(50), points).series).toEqual([
      100, 60, 0,
    ]);
  });

  test("shows a placeholder when the window held no ping cycles", () => {
    expect(availabilityFigure(Option.none(), []).value).toBe("-");
  });
});

describe("latencyFigure", () => {
  const metrics = [
    { timestamp: "2026-01-01T00:02:00.000Z", latency: 30 },
    { timestamp: "2026-01-01T00:01:00.000Z", latency: 10 },
    { timestamp: "2026-01-01T00:03:00.000Z" },
  ];

  test("labels the figure as an average, in ms", () => {
    const figure = latencyFigure(metrics);

    expect(figure.label).toBe("Latency");
    expect(figure.value).toBe("20.0");
    expect(figure.unit).toBe("ms");
    expect(figure.caption).toBe("avg");
  });

  test("plots readings in time order, leaving a gap for a missing one", () => {
    expect(latencyFigure(metrics).series).toEqual([10, 30, null]);
  });

  test("shows a placeholder with no readings", () => {
    expect(latencyFigure([]).value).toBe("-");
  });
});

describe("packetLossFigure and jitterFigure", () => {
  test("report the average with their own unit", () => {
    const metrics = [
      { timestamp: "2026-01-01T00:01:00.000Z", packet_loss: 0, jitter: 2 },
      { timestamp: "2026-01-01T00:02:00.000Z", packet_loss: 1, jitter: 4 },
    ];

    expect(packetLossFigure(metrics)).toMatchObject({
      label: "Packet loss",
      value: "0.5",
      unit: "%",
      caption: "avg",
      series: [0, 1],
    });
    expect(jitterFigure(metrics)).toMatchObject({
      label: "Jitter",
      value: "3.0",
      unit: "ms",
      caption: "avg",
      series: [2, 4],
    });
  });

  test("keep a genuine zero distinct from a missing reading", () => {
    const metrics = [
      { timestamp: "2026-01-01T00:01:00.000Z", packet_loss: 0 },
      { timestamp: "2026-01-01T00:02:00.000Z" },
    ];

    expect(packetLossFigure(metrics).value).toBe("0.0");
    expect(packetLossFigure(metrics).series).toEqual([0, null]);
  });
});

describe("speedFigure", () => {
  test("reports the most recent test's download and upload together", () => {
    const figure = speedFigure(
      [
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
      ],
      NOW_MS
    );

    expect(figure.label).toBe("Download / Upload");
    expect(figure.value).toBe("123 / 12.3");
    expect(figure.unit).toBe("Mbps");
    expect(figure.caption).toBe("latest test, 30s ago");
  });

  test("sparkles the download series in time order", () => {
    const figure = speedFigure(
      [
        { timestamp: "2026-01-01T11:59:30.000Z", download_speed: 3 },
        { timestamp: "2026-01-01T11:00:00.000Z", download_speed: 1 },
        { timestamp: "2026-01-01T11:30:00.000Z" },
      ],
      NOW_MS
    );

    expect(figure.series).toEqual([1, null, 3]);
  });

  test("shows a placeholder with no tests", () => {
    const figure = speedFigure([], NOW_MS);

    expect(figure.value).toBe("-");
    expect(figure.caption).toBe("no tests yet");
    expect(figure.series).toEqual([]);
  });

  test("renders each half of the pair independently when one measurement is missing", () => {
    const figure = speedFigure(
      [{ timestamp: "2026-01-01T11:59:30.000Z", download_speed: 50 }],
      NOW_MS
    );

    expect(figure.value).toBe("50.0 / -");
  });

  test("rounds triple-digit speeds to whole numbers and keeps one decimal below 100", () => {
    const figure = speedFigure(
      [
        {
          timestamp: "2026-01-01T11:59:30.000Z",
          download_speed: 941.4,
          upload_speed: 99.94,
        },
      ],
      NOW_MS
    );

    expect(figure.value).toBe("941 / 99.9");
  });

  test("keeps a genuine zero reading distinct from a missing one", () => {
    const figure = speedFigure(
      [
        {
          timestamp: "2026-01-01T11:59:30.000Z",
          download_speed: 0,
          upload_speed: 0,
        },
      ],
      NOW_MS
    );

    expect(figure.value).toBe("0.0 / 0.0");
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

  test("falls back to Unknown ISP with no external IP when the field is missing", () => {
    expect(networkInfo([{ isp: undefined, external_ip: undefined }])).toEqual({
      isp: "Unknown ISP",
      maybeExternalIp: Option.none(),
    });
  });

  test("falls back to Unknown ISP with no samples", () => {
    expect(networkInfo([])).toEqual({
      isp: "Unknown ISP",
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

  test("falls back to Unknown ISP when no sample has one", () => {
    expect(
      networkInfo([
        { isp: undefined, external_ip: "1.2.3.4" },
        { isp: undefined, external_ip: "5.6.7.8" },
      ])
    ).toEqual({ isp: "Unknown ISP", maybeExternalIp: Option.none() });
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
