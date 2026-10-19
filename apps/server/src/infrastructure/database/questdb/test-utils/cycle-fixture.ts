import type { NetworkMetric } from "@shared/metrics";

export type FixtureStatus = "up" | "degraded" | "down";

export interface FixtureReading {
  readonly host: string;
  /** When the host's row was stamped, after the cycle's start. */
  readonly offsetMs: number;
  readonly status: FixtureStatus;
}

/** One ping round, described once and written in each of the shapes the writer has produced. */
export interface FixtureCycle {
  readonly startMs: number;
  readonly readings: readonly FixtureReading[];
}

export const HOSTS = ["8.8.8.8", "1.1.1.1", "cloudflare.com"] as const;

/** Per-host offsets of a normal legacy cycle. */
const LEGACY_OFFSETS_MS = [0, 3, 8] as const;

/** What a start-stamped row records as the time its ping ran. */
const ANSWERED_DURATION_MS = 2_400;
const FAILED_DURATION_MS = 8_000;

export const reading = (
  host: string,
  offsetMs: number,
  status: FixtureStatus = "up"
): FixtureReading => ({ host, offsetMs, status });

/** All three hosts in one status at the usual legacy offsets. */
export const fullCycle = (
  startMs: number,
  status: FixtureStatus = "up",
  statuses: Partial<Record<(typeof HOSTS)[number], FixtureStatus>> = {}
): FixtureCycle => ({
  startMs,
  readings: HOSTS.map((host, index) =>
    reading(host, LEGACY_OFFSETS_MS[index] ?? 0, statuses[host] ?? status)
  ),
});

/** A round whose hosts are stamped at the given offsets, each with the status `statusOf` gives its position. */
export const roundAt = (
  startMs: number,
  offsets: readonly number[],
  statusOf: (position: number) => FixtureStatus = () => "up"
): FixtureCycle => ({
  startMs,
  readings: HOSTS.map((host, position) =>
    reading(host, offsets[position] ?? 0, statusOf(position))
  ),
});

const pingRow = (
  timestampMs: number,
  { host, status }: FixtureReading,
  seed: number,
  durationMs?: number
): NetworkMetric => ({
  timestamp: new Date(timestampMs),
  source: "ping",
  host,
  ...(status === "down"
    ? { packetLoss: 100, connectivityStatus: "down" as const }
    : {
        latency: 15 + (seed % 17) + (host.length % 5),
        jitter: 1 + (seed % 7) / 4,
        packetLoss: status === "degraded" ? 30 : 0,
        connectivityStatus: "up" as const,
      }),
  ...(durationMs === undefined ? {} : { durationMs }),
});

/** A ping row on its own, as a manual ping or a lone host leaves one. */
export const singleRow = (
  timestampMs: number,
  host: string,
  status: FixtureStatus = "up"
): NetworkMetric => pingRow(timestampMs, reading(host, 0, status), host.length);

const rowsOf = (
  cycles: readonly FixtureCycle[],
  stampOf: (cycle: FixtureCycle, item: FixtureReading, index: number) => number,
  durationOf?: (item: FixtureReading) => number
): NetworkMetric[] =>
  cycles.flatMap((cycle, index) =>
    cycle.readings.map((item, position) =>
      pingRow(
        stampOf(cycle, item, position),
        item,
        index * 7 + position,
        durationOf?.(item)
      )
    )
  );

/** Each host stamped when its own ping finished, as versions before 1.1.0 did. */
export const legacyRows = (cycles: readonly FixtureCycle[]): NetworkMetric[] =>
  rowsOf(cycles, (cycle, item) => cycle.startMs + item.offsetMs);

/** Every host stamped with the cycle's first timestamp, as versions from 1.1.0 until migration v4 did. */
export const sharedRows = (cycles: readonly FixtureCycle[]): NetworkMetric[] =>
  rowsOf(
    cycles,
    (cycle) =>
      cycle.startMs + Math.min(...cycle.readings.map((item) => item.offsetMs))
  );

/**
 * Each host stamped when its own ping started, a few milliseconds apart, with
 * the `duration_ms` the writer records. `skewMs` is the gap between the
 * stamps of consecutive hosts in a round.
 */
export const startStampedRows = (
  cycles: readonly FixtureCycle[],
  skewMs = 1
): NetworkMetric[] =>
  rowsOf(
    cycles,
    (cycle, _item, position) => cycle.startMs + position * skewMs,
    (item) =>
      item.status === "down" ? FAILED_DURATION_MS : ANSWERED_DURATION_MS
  );

export const speedtestRow = (timestampMs: number, seed = 1): NetworkMetric => ({
  timestamp: new Date(timestampMs),
  source: "speedtest",
  connectivityStatus: "up",
  downloadBandwidth: 250_000_000 + seed * 1_000_003,
  uploadBandwidth: 20_000_000 + seed,
  latency: 12 + seed,
  serverLocation: "Zürich, CH",
  isp: "Example Fiber",
  externalIp: "203.0.113.7",
  internalIp: "192.168.1.10",
});
