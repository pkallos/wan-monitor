import { Option } from "effect";
import { describe, expect, test } from "vitest";
import {
  CHECKING_CONNECTIVITY_CARD,
  downloadSpeedCard,
  liveConnectivityCard,
  networkInfo,
  uploadSpeedCard,
} from "@/dashboard/summaryCards";

const NOW_MS = Date.parse("2026-01-01T12:00:00.000Z");
const THIRTY_SECONDS_AGO = Option.some(NOW_MS - 30_000);

describe("liveConnectivityCard", () => {
  test("reports Online/good for a reachable cycle", () => {
    const card = liveConnectivityCard(
      { status: "up", maybeLastSampleAtMs: THIRTY_SECONDS_AGO },
      NOW_MS
    );

    expect(card.title).toBe("Connectivity");
    expect(card.value).toBe("Online");
    expect(card.status).toEqual(Option.some("good"));
    expect(card.subtitle).toEqual(Option.some("as of 30s ago"));
  });

  test("reports Degraded/warning for a lossy cycle", () => {
    const card = liveConnectivityCard(
      { status: "degraded", maybeLastSampleAtMs: THIRTY_SECONDS_AGO },
      NOW_MS
    );

    expect(card.value).toBe("Degraded");
    expect(card.status).toEqual(Option.some("warning"));
  });

  test("reports Offline/error for a fully-down cycle", () => {
    const card = liveConnectivityCard(
      { status: "down", maybeLastSampleAtMs: THIRTY_SECONDS_AGO },
      NOW_MS
    );

    expect(card.value).toBe("Offline");
    expect(card.status).toEqual(Option.some("error"));
  });

  // A quiet monitor and a down link are different facts, so noInfo must never
  // borrow the red "error" treatment an outage gets.
  test("reports No Data as neutral, not error, and says when the monitor last reported", () => {
    const card = liveConnectivityCard(
      {
        status: "noInfo",
        maybeLastSampleAtMs: Option.some(NOW_MS - 4 * 60 * 60 * 1000),
      },
      NOW_MS
    );

    expect(card.value).toBe("No Data");
    expect(card.status).toEqual(Option.some("neutral"));
    expect(card.status).not.toEqual(Option.some("error"));
    expect(card.subtitle).toEqual(Option.some("last seen 4h ago"));
  });

  test("says there is no monitoring data when nothing was ever recorded", () => {
    const card = liveConnectivityCard(
      { status: "noInfo", maybeLastSampleAtMs: Option.none() },
      NOW_MS
    );

    expect(card.value).toBe("No Data");
    expect(card.subtitle).toEqual(Option.some("no monitoring data"));
  });

  test("omits the subtitle when a reachable cycle carries no sample time", () => {
    const card = liveConnectivityCard(
      { status: "up", maybeLastSampleAtMs: Option.none() },
      NOW_MS
    );

    expect(card.subtitle).toEqual(Option.none());
  });
});

describe("CHECKING_CONNECTIVITY_CARD", () => {
  test("shows a neutral checking state rather than a false No Data", () => {
    expect(CHECKING_CONNECTIVITY_CARD).toEqual({
      title: "Connectivity",
      value: "Checking…",
      status: Option.none(),
      subtitle: Option.none(),
    });
  });
});

describe("downloadSpeedCard", () => {
  test("reports the most recent sample's download speed", () => {
    const card = downloadSpeedCard([
      { download_speed: 123.45, timestamp: "2026-01-01T00:00:00.000Z" },
      { download_speed: 50, timestamp: "2025-12-31T00:00:00.000Z" },
    ]);

    expect(card.title).toBe("Download Speed");
    expect(card.value).toBe("123.5 Mbps");
    expect(card.status).toEqual(Option.some("good"));
  });

  test("includes an 'as of' time-ago subtitle from the latest sample's timestamp", () => {
    const card = downloadSpeedCard([
      { download_speed: 123.45, timestamp: new Date().toISOString() },
    ]);

    expect(Option.getOrElse(card.subtitle, () => "")).toMatch(
      /^as of \d+s ago$/
    );
  });

  test("shows a placeholder with no samples", () => {
    expect(downloadSpeedCard([])).toEqual({
      title: "Download Speed",
      value: "- Mbps",
      status: Option.none(),
      subtitle: Option.none(),
    });
  });
});

describe("uploadSpeedCard", () => {
  test("reports the most recent sample's upload speed", () => {
    const card = uploadSpeedCard([
      { upload_speed: 12.3, timestamp: "2026-01-01T00:00:00.000Z" },
    ]);

    expect(card.title).toBe("Upload Speed");
    expect(card.value).toBe("12.3 Mbps");
    expect(card.status).toEqual(Option.some("good"));
  });

  test("shows a placeholder with no samples", () => {
    expect(uploadSpeedCard([])).toEqual({
      title: "Upload Speed",
      value: "- Mbps",
      status: Option.none(),
      subtitle: Option.none(),
    });
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
});
