import type { HostSummary } from "@shared/api/routes/summary";
import { Option } from "effect";
import { describe, expect, test } from "vitest";
import { hostRows, hostsCaption } from "@/dashboard/hostRows";

const host = (overrides: Partial<HostSummary> = {}): HostSummary => ({
  host: "1.1.1.1",
  latencyP50: 12.34,
  latencyP95: 31.8,
  avgPacketLoss: 0.456,
  avgJitter: 1.25,
  availabilityPercentage: 99.876,
  lastStatus: "up",
  ...overrides,
});

describe("hostRows", () => {
  test("formats each figure with its unit and a sensible precision", () => {
    expect(hostRows([host()])).toEqual([
      {
        host: "1.1.1.1",
        tone: "good",
        statusWord: "Up",
        p50: "12.3 ms",
        p95: "31.8 ms",
        loss: "0.46%",
        jitter: "1.3 ms",
        pingsAnswered: "99.88%",
      },
    ]);
  });

  test("words and tones each last status, never leaving a failure neutral", () => {
    const rows = hostRows([
      host({ lastStatus: "up" }),
      host({ lastStatus: "degraded" }),
      host({ lastStatus: "down" }),
    ]);

    expect(rows.map((row) => [row.statusWord, row.tone])).toEqual([
      ["Up", "good"],
      ["Degraded", "warning"],
      ["Down", "error"],
    ]);
  });

  test("shows a dash for every figure a host has no data for", () => {
    const [row] = hostRows([
      host({
        latencyP50: null,
        latencyP95: null,
        avgPacketLoss: null,
        avgJitter: null,
        availabilityPercentage: null,
      }),
    ]);

    expect([row.p50, row.p95, row.loss, row.jitter, row.pingsAnswered]).toEqual(
      ["-", "-", "-", "-", "-"]
    );
  });

  test("keeps a genuine zero distinct from missing", () => {
    const [row] = hostRows([host({ avgPacketLoss: 0, avgJitter: 0 })]);

    expect(row.loss).toBe("0.00%");
    expect(row.jitter).toBe("0.0 ms");
  });

  test("preserves the order the endpoint returned", () => {
    expect(
      hostRows([host({ host: "b" }), host({ host: "a" })]).map((r) => r.host)
    ).toEqual(["b", "a"]);
  });

  test("is empty with no hosts", () => {
    expect(hostRows([])).toEqual([]);
  });

  describe("against the configured hosts", () => {
    const configured = (hosts: ReadonlyArray<string>) => Option.some(hosts);

    test("gives a configured host the summary has no data for a No data row", () => {
      const rows = hostRows(
        [host({ host: "1.1.1.1" })],
        configured(["1.1.1.1", "cloudflare.com"])
      );

      expect(rows.map((row) => row.host)).toEqual([
        "1.1.1.1",
        "cloudflare.com",
      ]);
      expect(rows[1]).toEqual({
        host: "cloudflare.com",
        tone: "none",
        statusWord: "No data",
        p50: "-",
        p95: "-",
        loss: "-",
        jitter: "-",
        pingsAnswered: "-",
      });
    });

    test("follows the configured order, then lists a host the config no longer names", () => {
      const rows = hostRows(
        [
          host({ host: "old.example" }),
          host({ host: "b" }),
          host({ host: "a" }),
        ],
        configured(["a", "b", "c"])
      );

      expect(rows.map((row) => row.host)).toEqual([
        "a",
        "b",
        "c",
        "old.example",
      ]);
    });

    test("stays empty when the summary has no host at all, since the range held no pings", () => {
      expect(hostRows([], configured(["a", "b"]))).toEqual([]);
    });

    test("lists just the summary's hosts while the configuration is unknown", () => {
      expect(
        hostRows([host({ host: "b" }), host({ host: "a" })], Option.none()).map(
          (row) => row.host
        )
      ).toEqual(["b", "a"]);
    });
  });
});

describe("hostsCaption", () => {
  test("says how often each host is pinged, in words", () => {
    expect(hostsCaption(30)).toBe("Each host is pinged every 30 seconds.");
    expect(hostsCaption(60)).toBe("Each host is pinged every minute.");
    expect(hostsCaption(300)).toBe("Each host is pinged every 5 minutes.");
  });
});
