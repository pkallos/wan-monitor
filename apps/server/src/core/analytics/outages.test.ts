import { describe, expect, it } from "vitest";
import { summarizeOutages } from "@/core/analytics/outages";
import type { OutageRun } from "@/infrastructure/database/questdb/model";

const BASE = Date.parse("2024-01-01T00:00:00Z");

const iso = (offsetSeconds: number) =>
  new Date(BASE + offsetSeconds * 1000).toISOString();

const run = (
  startSeconds: number,
  endSeconds: number,
  overrides: Partial<OutageRun> = {}
): OutageRun => ({
  run_id: 1,
  start_time: iso(startSeconds),
  end_time: iso(endSeconds),
  had_down: true,
  max_packet_loss: 100,
  peak_latency: null,
  affected_hosts: ["8.8.8.8"],
  ...overrides,
});

const options = (rangeEndSeconds: number, rangeStartSeconds = 0) => ({
  rangeStartMs: BASE + rangeStartSeconds * 1000,
  rangeEndMs: BASE + rangeEndSeconds * 1000,
});

describe("summarizeOutages", () => {
  it("returns nothing for no runs", () => {
    expect(summarizeOutages([], options(600))).toEqual([]);
  });

  it("spans the run's own start and end", () => {
    expect(
      summarizeOutages(
        [
          run(90, 120, {
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

  it("keeps a fractional-second run exact", () => {
    const [outage] = summarizeOutages([run(322.7, 645.4)], options(1000));

    expect(outage).toMatchObject({
      start: iso(322.7),
      end: iso(645.4),
      durationSeconds: 322.7,
    });
  });

  it("calls a run down when any of its time was down and degraded otherwise", () => {
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

  it("reports a null peak latency when every ping in the outage failed", () => {
    const [outage] = summarizeOutages(
      [run(0, 30, { peak_latency: null })],
      options(600)
    );

    expect(outage?.peakLatency).toBeNull();
  });

  it("reports no loss when no ping in the outage measured any", () => {
    const [outage] = summarizeOutages(
      [run(0, 30, { max_packet_loss: null, peak_latency: null })],
      options(600)
    );

    expect(outage).toMatchObject({ maxPacketLoss: 0, peakLatency: null });
  });

  it("clips an outage still running at the range end to that end", () => {
    const [outage] = summarizeOutages([run(60, 120)], options(100));

    expect(outage).toMatchObject({
      start: iso(60),
      end: iso(100),
      durationSeconds: 40,
    });
  });

  it("clips an outage that began before the range to the range start", () => {
    const [outage] = summarizeOutages([run(-50, 30)], options(600));

    expect(outage).toMatchObject({
      start: iso(0),
      end: iso(30),
      durationSeconds: 30,
    });
  });

  it("clips both ends of an outage that spans the whole range", () => {
    const [outage] = summarizeOutages([run(-100, 900)], options(600, 10));

    expect(outage).toMatchObject({
      start: iso(10),
      end: iso(600),
      durationSeconds: 590,
    });
  });

  it("orders outages newest first", () => {
    const outages = summarizeOutages(
      [
        run(0, 10, { run_id: 1 }),
        run(60, 70, { run_id: 2 }),
        run(120, 130, { run_id: 3 }),
      ],
      options(600)
    );

    expect(outages.map((outage) => outage.start)).toEqual([
      iso(120),
      iso(60),
      iso(0),
    ]);
  });
});
