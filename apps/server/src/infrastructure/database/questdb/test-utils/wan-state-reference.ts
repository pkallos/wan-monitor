import type { NetworkMetric } from "@shared/metrics";
import {
  type Granularity,
  granularityToMs,
  PACKET_LOSS_THRESHOLDS,
} from "@wan-monitor/shared";

/**
 * A plain TypeScript statement of the WAN state rules, used by tests as the
 * expected value for what the SQL pipeline computes. It works in whole
 * microseconds, like the SQL, and shares none of its structure: it sweeps
 * per-host holds into stretches with ordinary loops.
 */

const MICROS = 1000;

export type StateCode = 0 | 1 | 2 | 3;

export interface ReferenceParams {
  readonly startMs: number;
  readonly endMs: number;
  readonly nowMs: number;
  readonly intervalMs: number;
  readonly hosts: readonly string[];
}

export interface ReferenceState {
  readonly startUs: number;
  readonly endUs: number;
  readonly state: StateCode;
  readonly spacingUs: number;
}

export interface ReferenceOutage {
  readonly startMs: number;
  readonly endMs: number;
  readonly status: "down" | "degraded";
  readonly hosts: readonly string[];
}

export interface ReferenceBucket {
  readonly bucketMs: number;
  readonly upMs: number;
  readonly degradedMs: number;
  readonly downMs: number;
  readonly status: "up" | "degraded" | "down";
}

export interface ReferenceResult {
  readonly states: readonly ReferenceState[];
  readonly outages: readonly ReferenceOutage[];
  readonly observedMs: number;
  readonly upMs: number;
  readonly degradedMs: number;
  /** The state of the stretch that reaches now; 0 when none does. */
  readonly liveState: StateCode;
}

interface Hold {
  readonly tsUs: number;
  readonly host: string;
  readonly heUs: number;
  readonly down: boolean;
  readonly bad: boolean;
  readonly packetLoss: number | undefined;
  readonly latency: number | undefined;
  readonly spacingUs: number;
}

interface Stretch {
  startUs: number;
  endUs: number;
  state: StateCode;
  spacingUs: number;
}

const MIN_SPACING_GAP_US = 1_000_000;

/** Rows ordered by time, as `lag` and `lead` see a host's rows; ties keep input order. */
const byHost = (
  rows: readonly NetworkMetric[]
): Map<string, NetworkMetric[]> => {
  const hosts = new Map<string, NetworkMetric[]>();
  for (const row of rows) {
    if (row.source !== "ping" || row.host === undefined) {
      continue;
    }
    const list = hosts.get(row.host) ?? [];
    list.push(row);
    hosts.set(row.host, list);
  }
  for (const list of hosts.values()) {
    list.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
  return hosts;
};

const median3 = (gaps: readonly number[], intervalUs: number): number => {
  const sorted = [...gaps].sort((a, b) => a - b);
  let spacing = intervalUs;
  if (sorted.length === 3) {
    spacing = sorted[1] ?? intervalUs;
  } else if (sorted.length === 2 || sorted.length === 1) {
    spacing = sorted[0] ?? intervalUs;
  }
  return Math.max(
    Math.min(spacing, intervalUs * 2),
    Math.floor(intervalUs / 2)
  );
};

const holdsOf = (
  rows: readonly NetworkMetric[],
  { nowMs, intervalMs, hosts }: ReferenceParams,
  scanStartUs: number,
  scanEndUs: number
): Hold[] => {
  const nowUs = nowMs * MICROS;
  const intervalUs = intervalMs * MICROS;
  const holds: Hold[] = [];

  for (const [host, all] of byHost(rows)) {
    const scanned = all.filter((row) => {
      const us = row.timestamp.getTime() * MICROS;
      return us >= scanStartUs && us <= scanEndUs;
    });
    const configured = hosts.includes(host);

    scanned.forEach((row, index) => {
      const tsUs = row.timestamp.getTime() * MICROS;
      const next = scanned[index + 1];
      const nextUs =
        next === undefined ? null : next.timestamp.getTime() * MICROS;

      const gaps: number[] = [];
      for (let back = 0; back < 3; back++) {
        const here = scanned[index - back];
        const before = scanned[index - back - 1];
        if (here === undefined || before === undefined) {
          continue;
        }
        const gap =
          (here.timestamp.getTime() - before.timestamp.getTime()) * MICROS;
        if (gap >= MIN_SPACING_GAP_US) {
          gaps.push(gap);
        }
      }
      const spacingUs = median3(gaps, intervalUs);

      const staleAfterUs = configured
        ? Math.floor((spacingUs * 5) / 2)
        : Math.floor((spacingUs * 3) / 2);
      let heUs: number;
      if (nextUs !== null && nextUs - tsUs <= staleAfterUs) {
        heUs = nextUs;
      } else if (
        configured
          ? nextUs === null && tsUs + staleAfterUs > nowUs
          : tsUs + spacingUs > nowUs
      ) {
        heUs = nowUs;
      } else {
        heUs = tsUs + spacingUs;
      }

      const down = row.connectivityStatus === "down";
      holds.push({
        tsUs,
        host,
        heUs,
        down,
        bad:
          down ||
          (row.packetLoss !== undefined &&
            row.packetLoss >= PACKET_LOSS_THRESHOLDS.degradedFloor),
        packetLoss: row.packetLoss,
        latency: row.latency,
        spacingUs,
      });
    });
  }
  return holds;
};

/** The quorum state over every hold standing in each interval between two events, with the spacing of the event that opens it. */
const intervalsOf = (holds: readonly Hold[]): Stretch[] => {
  const times = [
    ...new Set(holds.flatMap((hold) => [hold.tsUs, hold.heUs])),
  ].sort((a, b) => a - b);

  const intervals: Stretch[] = [];
  for (let i = 0; i + 1 < times.length; i++) {
    const startUs = times[i] ?? 0;
    const endUs = times[i + 1] ?? 0;
    const standing = holds.filter(
      (hold) => hold.tsUs <= startUs && hold.heUs > startUs
    );
    const spacingUs = Math.max(
      0,
      ...holds
        .filter((hold) => hold.tsUs === startUs || hold.heUs === startUs)
        .map((hold) => hold.spacingUs)
    );
    let state: StateCode = 1;
    if (standing.length === 0) {
      state = 0;
    } else if (standing.every((hold) => hold.down)) {
      state = 3;
    } else if (standing.some((hold) => hold.bad)) {
      state = 2;
    }
    intervals.push({ startUs, endUs, state, spacingUs });
  }
  return intervals;
};

const mergeStretches = (items: readonly Stretch[]): Stretch[] => {
  const merged: Stretch[] = [];
  for (const item of items) {
    const last = merged.at(-1);
    if (last !== undefined && last.state === item.state) {
      last.endUs = item.endUs;
      last.spacingUs = Math.max(last.spacingUs, item.spacingUs);
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
};

const floorOf = (stretch: Stretch): number => Math.floor(stretch.spacingUs / 2);

const lasts = (stretch: Stretch, nowUs: number): boolean =>
  stretch.endUs - stretch.startUs >= floorOf(stretch) || stretch.endUs >= nowUs;

/** Before the first stretch that lasts, a segment takes that stretch's state, or the longest's. */
const relabelSegmentStarts = (
  stretches: readonly Stretch[],
  nowUs: number
): Stretch[] => {
  const relabelled: Stretch[] = [];
  let segment: Stretch[] = [];
  const flush = (): void => {
    const firstLong = segment.find(
      (stretch) => stretch.state > 0 && lasts(stretch, nowUs)
    );
    let longest: Stretch | undefined;
    for (const stretch of segment) {
      if (stretch.state === 0) {
        continue;
      }
      const length = stretch.endUs - stretch.startUs;
      const best = longest === undefined ? -1 : longest.endUs - longest.startUs;
      if (
        longest === undefined ||
        length > best ||
        (length === best && stretch.state > longest.state)
      ) {
        longest = stretch;
      }
    }
    for (const stretch of segment) {
      if (stretch.state === 0) {
        relabelled.push(stretch);
      } else if (firstLong !== undefined) {
        relabelled.push(
          stretch.startUs < firstLong.startUs
            ? { ...stretch, state: firstLong.state }
            : stretch
        );
      } else {
        relabelled.push({ ...stretch, state: longest?.state ?? stretch.state });
      }
    }
    segment = [];
  };

  for (const stretch of stretches) {
    if (stretch.state === 0) {
      flush();
    }
    segment.push(stretch);
  }
  flush();
  return relabelled;
};

/** A stretch below the floor takes the state before it, unless it follows no data. */
const foldShortStretches = (
  stretches: readonly Stretch[],
  nowUs: number
): Stretch[] => {
  const states: Stretch[] = [];
  stretches.forEach((stretch, index) => {
    const before = stretches[index - 1];
    const keep =
      stretch.state === 0 ||
      before === undefined ||
      before.state === 0 ||
      lasts(stretch, nowUs);
    const last = states.at(-1);
    if (keep || last === undefined) {
      states.push({ ...stretch });
    } else {
      last.endUs = stretch.endUs;
      last.spacingUs = Math.max(last.spacingUs, stretch.spacingUs);
    }
  });
  return states;
};

export const statesOf = (
  rows: readonly NetworkMetric[],
  params: ReferenceParams
): { states: Stretch[]; holds: Hold[] } => {
  const preRollMs = Math.max(3_600_000, 10 * params.intervalMs);
  const holds = holdsOf(
    rows,
    params,
    (params.startMs - preRollMs) * MICROS,
    Math.min(params.endMs + preRollMs, params.nowMs) * MICROS
  );
  const nowUs = params.nowMs * MICROS;
  const stretches = mergeStretches(intervalsOf(holds));
  const states = foldShortStretches(
    relabelSegmentStarts(stretches, nowUs),
    nowUs
  );
  return { states, holds };
};

const clip = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/** Outage runs and the hosts behind them, clipped to the window as the handler clips them. */
const outagesOf = (
  states: readonly Stretch[],
  holds: readonly Hold[],
  { startMs, endMs, nowMs }: ReferenceParams
): ReferenceOutage[] => {
  const lowUs = startMs * MICROS;
  const highUs = Math.min(endMs, nowMs) * MICROS;

  const runs: {
    startUs: number;
    endUs: number;
    down: boolean;
    spacingUs: number;
  }[] = [];
  let open = false;
  for (const state of states) {
    if (state.state >= 2) {
      const last = runs.at(-1);
      if (open && last !== undefined) {
        last.endUs = state.endUs;
        last.down = last.down || state.state === 3;
        last.spacingUs = Math.max(last.spacingUs, state.spacingUs);
      } else {
        runs.push({
          startUs: state.startUs,
          endUs: state.endUs,
          down: state.state === 3,
          spacingUs: state.spacingUs,
        });
      }
      open = true;
    } else {
      open = false;
    }
  }

  const windowed = runs.filter(
    (run) => run.endUs > lowUs && run.startUs < highUs
  );

  // A hold belongs to the last windowed run that starts before the hold ends,
  // as the SQL's ASOF JOIN pairs them.
  const hostsByRun = windowed.map(() => new Map<string, boolean>());
  for (const hold of holds) {
    let index = -1;
    windowed.forEach((run, position) => {
      if (run.startUs <= hold.heUs - 1) {
        index = position;
      }
    });
    const run = windowed[index];
    if (run === undefined || hold.tsUs >= run.endUs) {
      continue;
    }
    const overlapUs =
      Math.min(hold.heUs, run.endUs) - Math.max(hold.tsUs, run.startUs);
    const spanUs = run.endUs - run.startUs;
    if (
      hold.bad &&
      (overlapUs >= Math.floor(run.spacingUs / 2) || overlapUs === spanUs)
    ) {
      hostsByRun[index]?.set(hold.host, true);
    }
  }

  return windowed.map((run, index) => ({
    startMs: clip(run.startUs, lowUs, highUs) / MICROS,
    endMs: clip(run.endUs, lowUs, highUs) / MICROS,
    status: run.down ? ("down" as const) : ("degraded" as const),
    hosts: [...(hostsByRun[index]?.keys() ?? [])].sort(),
  }));
};

export const referenceOf = (
  rows: readonly NetworkMetric[],
  params: ReferenceParams
): ReferenceResult => {
  const { states, holds } = statesOf(rows, params);
  const lowUs = params.startMs * MICROS;
  const highUs = Math.min(params.endMs, params.nowMs) * MICROS;
  const nowUs = params.nowMs * MICROS;

  let upUs = 0;
  let degradedUs = 0;
  let observedUs = 0;
  for (const state of states) {
    if (state.state === 0) {
      continue;
    }
    const length =
      clip(state.endUs, lowUs, highUs) - clip(state.startUs, lowUs, highUs);
    observedUs += length;
    if (state.state === 1) {
      upUs += length;
    } else if (state.state === 2) {
      degradedUs += length;
    }
  }

  const live = states.find((state) => state.endUs >= nowUs && state.state > 0);

  return {
    states: states.map(({ startUs, endUs, state, spacingUs }) => ({
      startUs,
      endUs,
      state,
      spacingUs,
    })),
    outages: outagesOf(states, holds, params),
    observedMs: observedUs / MICROS,
    upMs: upUs / MICROS,
    degradedMs: degradedUs / MICROS,
    liveState: live?.state ?? 0,
  };
};

/** Time per state in each bucket of the grid, split exactly at bucket edges. */
export const bucketsOf = (
  rows: readonly NetworkMetric[],
  params: ReferenceParams,
  granularity: Granularity,
  degradedShare: number
): ReferenceBucket[] => {
  const { states } = statesOf(rows, params);
  const widthMs = granularityToMs(granularity);
  const lowMs = params.startMs;
  const highMs = Math.min(params.endMs, params.nowMs);
  const buckets = new Map<
    number,
    { up: number; degraded: number; down: number }
  >();

  for (const state of states) {
    if (state.state === 0) {
      continue;
    }
    let cursor = Math.max(state.startUs / MICROS, lowMs);
    const end = Math.min(state.endUs / MICROS, highMs);
    while (cursor < end) {
      const bucketMs = Math.floor(cursor / widthMs) * widthMs;
      const piece = Math.min(end, bucketMs + widthMs) - cursor;
      const entry = buckets.get(bucketMs) ?? { up: 0, degraded: 0, down: 0 };
      if (state.state === 1) {
        entry.up += piece;
      } else if (state.state === 2) {
        entry.degraded += piece;
      } else {
        entry.down += piece;
      }
      buckets.set(bucketMs, entry);
      cursor += piece;
    }
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bucketMs, { up, degraded, down }]) => {
      const observed = up + degraded + down;
      let status: ReferenceBucket["status"] = "up";
      if (down > 0) {
        status = "down";
      } else if (observed > 0 && degraded / observed >= degradedShare) {
        status = "degraded";
      }
      return { bucketMs, upMs: up, degradedMs: degraded, downMs: down, status };
    });
};
