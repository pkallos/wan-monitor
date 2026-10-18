import { describe, expect, it } from "vitest";
import {
  OUTAGE_MERGE_GAP_PERIODS,
  outageMergeGapMs,
  summarizeOutages,
} from "@/core/analytics/outages";
import type { OutageRun } from "@/infrastructure/database/questdb/model";

const BASE = Date.parse("2024-01-01T00:00:00Z");
const PERIOD_MS = 30_000;

const iso = (offsetSeconds: number) =>
  new Date(BASE + offsetSeconds * 1000).toISOString();

const run = (
  startSeconds: number,
  lastSeconds: number,
  overrides: Partial<OutageRun> = {}
): OutageRun => ({
  run_id: 1,
  start_time: iso(startSeconds),
  last_time: iso(lastSeconds),
  recovered_time: null,
  had_down: true,
  max_packet_loss: 100,
  peak_latency: null,
  affected_hosts: ["8.8.8.8"],
  ...overrides,
});

const options = (rangeEndSeconds: number, periodMs = PERIOD_MS) => ({
  periodMs,
  rangeEndMs: BASE + rangeEndSeconds * 1000,
});

describe("outageMergeGapMs", () => {
  it("scales the period by the merge factor", () => {
    expect(outageMergeGapMs(PERIOD_MS)).toBe(
      PERIOD_MS * OUTAGE_MERGE_GAP_PERIODS
    );
    expect(outageMergeGapMs(PERIOD_MS)).toBe(75_000);
  });
});

describe("summarizeOutages", () => {
  it("returns nothing for no runs", () => {
    expect(summarizeOutages([], options(600))).toEqual([]);
  });

  it("spans one period for a run of a single cycle", () => {
    expect(
      summarizeOutages(
        [
          run(90, 90, {
            had_down: false,
            max_packet_loss: 40,
            peak_latency: 80,
            affected_hosts: ["1.1.1.1"],
          }),
        ],
        options(600)
      )
    ).toEqual([
      {
        start: iso(90),
        end: iso(120),
        durationSeconds: 30,
        status: "degraded",
        affectedHosts: ["1.1.1.1"],
        maxPacketLoss: 40,
        peakLatency: 80,
      },
    ]);
  });

  it("ends a run one period after its last cycle", () => {
    const [outage] = summarizeOutages([run(60, 120)], options(600));

    expect(outage).toMatchObject({
      start: iso(60),
      end: iso(150),
      durationSeconds: 90,
    });
  });

  it("ends a run at the up cycle recorded after it", () => {
    const [outage] = summarizeOutages(
      [run(60, 120, { recovered_time: iso(165) })],
      options(600)
    );

    expect(outage).toMatchObject({
      start: iso(60),
      end: iso(165),
      durationSeconds: 105,
    });
  });

  it("ends a single-cycle run at the up cycle after it, whatever the period", () => {
    const [outage] = summarizeOutages(
      [run(60, 60, { recovered_time: iso(90) })],
      options(600, 30_000_000)
    );

    expect(outage).toMatchObject({ end: iso(90), durationSeconds: 30 });
  });

  it("calls a run down when any cycle was down and degraded otherwise", () => {
    const [newest, oldest] = summarizeOutages(
      [run(0, 30, { had_down: true }), run(60, 90, { had_down: false })],
      options(600)
    );

    expect(newest?.status).toBe("degraded");
    expect(oldest?.status).toBe("down");
  });

  it("lists affected hosts sorted", () => {
    const [outage] = summarizeOutages(
      [
        run(0, 30, {
          affected_hosts: ["cloudflare.com", "8.8.8.8", "1.1.1.1"],
        }),
      ],
      options(600)
    );

    expect(outage?.affectedHosts).toEqual([
      "1.1.1.1",
      "8.8.8.8",
      "cloudflare.com",
    ]);
  });

  it("reports a null peak latency when every sample in the outage failed", () => {
    const [outage] = summarizeOutages(
      [run(0, 30, { peak_latency: null })],
      options(600)
    );

    expect(outage?.peakLatency).toBeNull();
  });

  it("reports no loss and no latency when no cycle in the outage measured either", () => {
    const [outage] = summarizeOutages(
      [run(0, 30, { max_packet_loss: null, peak_latency: null })],
      options(600)
    );

    expect(outage).toMatchObject({ maxPacketLoss: 0, peakLatency: null });
  });

  it("clips an outage still running at the range end to that end", () => {
    const [outage] = summarizeOutages([run(60, 90)], options(100));

    expect(outage).toMatchObject({
      start: iso(60),
      end: iso(100),
      durationSeconds: 40,
    });
  });

  it("clips a recovery recorded after the range end to that end", () => {
    const [outage] = summarizeOutages(
      [run(60, 90, { recovered_time: iso(120) })],
      options(100)
    );

    expect(outage).toMatchObject({
      start: iso(60),
      end: iso(100),
      durationSeconds: 40,
    });
  });

  it("orders outages newest first", () => {
    const outages = summarizeOutages(
      [
        run(0, 0, { run_id: 1 }),
        run(60, 60, { run_id: 2 }),
        run(120, 120, { run_id: 3 }),
      ],
      options(600)
    );

    expect(outages.map((outage) => outage.start)).toEqual([
      iso(120),
      iso(60),
      iso(0),
    ]);
  });

  it("ends a run from the given period", () => {
    const [outage] = summarizeOutages([run(200, 300)], options(1000, 100_000));

    expect(outage).toMatchObject({
      start: iso(200),
      end: iso(400),
      durationSeconds: 200,
    });
  });
});
