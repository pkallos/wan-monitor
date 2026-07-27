import { Option } from "effect";
import { describe, expect, test } from "vitest";
import {
  connectivityCard,
  downloadSpeedCard,
  networkInfo,
  uploadSpeedCard,
} from "@/dashboard/summaryCards";

describe("connectivityCard", () => {
  test("reports Online/good from the most recent sample's connectivity_status", () => {
    const card = connectivityCard([
      { connectivity_status: "up", timestamp: "2026-01-01T00:00:00.000Z" },
      { connectivity_status: "down", timestamp: "2025-12-31T00:00:00.000Z" },
    ]);

    expect(card.title).toBe("Connectivity");
    expect(card.value).toBe("Online");
    expect(card.status).toEqual(Option.some("good"));
  });

  test("reports Offline/error when the most recent sample isn't up", () => {
    const card = connectivityCard([
      { connectivity_status: "down", timestamp: "2026-01-01T00:00:00.000Z" },
    ]);

    expect(card.title).toBe("Connectivity");
    expect(card.value).toBe("Offline");
    expect(card.status).toEqual(Option.some("error"));
  });

  test("falls back to Offline/error with no samples", () => {
    const card = connectivityCard([]);

    expect(card).toEqual({
      title: "Connectivity",
      value: "Offline",
      status: Option.some("error"),
      subtitle: Option.none(),
    });
  });

  test("includes an 'as of' time-ago subtitle from the latest sample's timestamp", () => {
    const card = connectivityCard([
      { connectivity_status: "up", timestamp: new Date().toISOString() },
    ]);

    expect(Option.getOrElse(card.subtitle, () => "")).toMatch(
      /^as of \d+s ago$/
    );
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
