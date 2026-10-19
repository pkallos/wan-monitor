import {
  LIVE_WINDOW_PING_MULTIPLIER,
  PACKET_LOSS_THRESHOLDS,
} from "@wan-monitor/shared";
import {
  type QueryStateParams,
  WAN_STATE,
} from "@/infrastructure/database/questdb/model";

/**
 * The WAN state pipeline. Every host's ping row stands for that host until its
 * next row (or a bounded time), the standing rows vote a state at each instant,
 * and the instants fold into stretches. Durations are microseconds in SQL and
 * milliseconds in TypeScript.
 */

/** Number of gaps behind a row that set its spacing. The median of three absorbs one manual ping or one missed round. */
const SPACING_GAPS = 3;

/** A gap under a second is a duplicate host or the same round, not spacing. */
const MIN_SPACING_GAP_MICROS = 1_000_000;

/** Smallest spacing a row can have, in half-intervals (1 is 0.5 intervals), so two manual pings seconds apart cannot shrink it to nothing. */
const MIN_SPACING_HALF_INTERVALS = 1;

/** Largest spacing a row can have, in intervals, which bounds how long a sparse host holds. */
const MAX_SPACING_INTERVALS = 2;

/**
 * Longest gap a configured host's row bridges to its next row, in half-spacings
 * (5 is 2.5 spacings): one missed round, not two. The live window is the same
 * bound, taken at the configured interval.
 */
const STALE_AFTER_HALF_PERIODS = LIVE_WINDOW_PING_MULTIPLIER * 2;

/** Longest gap an unconfigured host's row bridges, in half-spacings (3 is 1.5 spacings), so a missed round never hides an outage behind a stray name. */
const UNCONFIGURED_STALE_HALF_PERIODS = 3;

/** Shortest state that stands on its own, in half-spacings (1 is 0.5 spacings); a shorter one is below the sampling resolution and takes a neighbour's. */
export const RESOLUTION_FLOOR_HALF_PERIODS = 1;

/** History scanned before a window so that a row's spacing (three gaps), the longest hold and the segment start are known at the window's first row: the longer of 1 hour and 10 intervals. */
const PRE_ROLL_MIN_MS = 3_600_000;
const PRE_ROLL_INTERVALS = 10;

/** A state code is packed into the low digit of a time or a duration in base `STATE_SLOTS`, which must exceed the largest code. */
const STATE_SLOTS = 4;

const MICROS_PER_MS = 1000;

const preRollMs = (intervalMs: number): number =>
  Math.max(PRE_ROLL_MIN_MS, PRE_ROLL_INTERVALS * intervalMs);

/**
 * The six leading bind values of every state statement: window start, window
 * end clipped to now, scan start, scan end clipped to now, now, and the
 * configured interval. All are integer microseconds, never ISO strings: QuestDB
 * rejects a bound string used inside an expression (`cast($n as timestamp)`,
 * `datediff`, `CASE`).
 */
export const stateParams = ({
  startTime,
  endTime,
  nowMs,
  intervalMs,
}: Pick<
  QueryStateParams,
  "startTime" | "endTime" | "nowMs" | "intervalMs"
>): readonly number[] => {
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();
  const preRoll = preRollMs(intervalMs);
  return [
    startMs * MICROS_PER_MS,
    Math.min(endMs, nowMs) * MICROS_PER_MS,
    (startMs - preRoll) * MICROS_PER_MS,
    Math.min(endMs + preRoll, nowMs) * MICROS_PER_MS,
    nowMs * MICROS_PER_MS,
    intervalMs * MICROS_PER_MS,
  ];
};

const hostList = (from: number, count: number): string =>
  count === 0
    ? "NULL"
    : Array.from({ length: count }, (_, i) => `$${from + i}`).join(", ");

const SPACING_WINDOW = `ROWS BETWEEN ${SPACING_GAPS - 1} PRECEDING AND CURRENT ROW`;

/**
 * The CTE chain that turns a table's ping rows into `states (state_no, s, e,
 * st, p)`: contiguous stretches with a state code (0 no data, 1 up, 2
 * degraded, 3 down) and the spacing behind them. Binds `$1` to `$6` as
 * `stateParams` gives them, then the configured hosts from `$hostsFrom`.
 * Each subquery holds one window step, because QuestDB cannot nest window
 * functions in one SELECT. A stretch that reaches now (`$5`) counts as long
 * for the floor, so an onset or a recovery reads at once.
 */
export const wanStatesSql = (
  table: string,
  hostsFrom: number,
  hostCount: number
): string => `
raw_rows AS (
  SELECT ts, host, packet_loss, latency, d, b, configured, nxt,
    CASE WHEN datediff('u', prev, ts) >= ${MIN_SPACING_GAP_MICROS} THEN datediff('u', prev, ts) END gap
  FROM (
    SELECT timestamp ts, host, packet_loss, latency,
      CASE WHEN connectivity_status = 'down' THEN 1 ELSE 0 END d,
      CASE WHEN connectivity_status = 'down' OR packet_loss >= ${PACKET_LOSS_THRESHOLDS.degradedFloor} THEN 1 ELSE 0 END b,
      CASE WHEN host IN (${hostList(hostsFrom, hostCount)}) THEN 1 ELSE 0 END configured,
      lead(timestamp) OVER (PARTITION BY host ORDER BY timestamp) nxt,
      lag(timestamp) OVER (PARTITION BY host ORDER BY timestamp) prev
    FROM ${table} WHERE timestamp >= $3 AND timestamp <= $4 AND source = 'ping')),
rolling AS (
  SELECT ts, host, packet_loss, latency, d, b, configured, nxt,
    count(gap) OVER (PARTITION BY host ORDER BY ts ${SPACING_WINDOW}) n3, sum(gap) OVER (PARTITION BY host ORDER BY ts ${SPACING_WINDOW}) s3,
    min(gap) OVER (PARTITION BY host ORDER BY ts ${SPACING_WINDOW}) lo3, max(gap) OVER (PARTITION BY host ORDER BY ts ${SPACING_WINDOW}) hi3
  FROM raw_rows),
spaced AS (
  SELECT ts, host, packet_loss, latency, d, b, configured, nxt,
    greatest(least(CASE WHEN n3 = 0 THEN cast($6 as long) WHEN n3 = ${SPACING_GAPS} THEN cast(s3 - lo3 - hi3 as long) WHEN n3 = ${SPACING_GAPS - 1} THEN cast(lo3 as long) ELSE cast(hi3 as long) END, cast($6 as long) * ${MAX_SPACING_INTERVALS}), cast($6 as long) * ${MIN_SPACING_HALF_INTERVALS} / 2) p
  FROM rolling),
holds AS (
  SELECT ts, host, packet_loss, latency, d, b, p,
    CASE
      WHEN configured = 1 AND nxt IS NOT NULL AND datediff('u', ts, nxt) <= p * ${STALE_AFTER_HALF_PERIODS} / 2 THEN nxt
      WHEN configured = 1 AND nxt IS NULL AND ts + p * ${STALE_AFTER_HALF_PERIODS} / 2 > cast($5 as timestamp) THEN cast($5 as timestamp)
      WHEN configured = 1 THEN ts + p
      WHEN nxt IS NOT NULL AND datediff('u', ts, nxt) <= p * ${UNCONFIGURED_STALE_HALF_PERIODS} / 2 THEN nxt
      WHEN ts + p > cast($5 as timestamp) THEN cast($5 as timestamp)
      ELSE ts + p END he
  FROM spaced),
events AS (SELECT ts et, 1 k, d, b, p FROM holds UNION ALL SELECT he et, -1 k, -d d, -b b, p FROM holds),
grouped AS (SELECT et, sum(k) k, sum(d) d, sum(b) b, max(p) p FROM events GROUP BY et ORDER BY et),
running AS (SELECT et, p,
   sum(k) OVER (ORDER BY et ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) known,
   sum(d) OVER (ORDER BY et ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) down,
   sum(b) OVER (ORDER BY et ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) bad,
   lead(et) OVER (ORDER BY et) nt FROM grouped),
intervals AS (SELECT et, nt, p, CASE WHEN known = 0 THEN ${WAN_STATE.noData} WHEN down = known THEN ${WAN_STATE.down} WHEN bad > 0 THEN ${WAN_STATE.degraded} ELSE ${WAN_STATE.up} END st
   FROM running WHERE nt IS NOT NULL),
changes AS (SELECT et, nt, p, st, CASE WHEN prev_st IS NULL OR prev_st <> st THEN 1 ELSE 0 END c
   FROM (SELECT et, nt, p, st, lag(st) OVER (ORDER BY et) prev_st FROM intervals)),
numbered_changes AS (SELECT et, nt, p, st, sum(c) OVER (ORDER BY et ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) stretch_no FROM changes),
stretches AS (SELECT stretch_no, min(et) et, max(nt) nt, first(st) st, max(p) p FROM numbered_changes GROUP BY stretch_no ORDER BY stretch_no),
segmented AS (SELECT et, nt, st, p,
     sum(CASE WHEN st = ${WAN_STATE.noData} THEN 1 ELSE 0 END) OVER (ORDER BY et ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) segment_no
   FROM stretches),
anchored AS (SELECT et, nt, st, p,
     min(CASE WHEN st > ${WAN_STATE.noData} AND (datediff('u', et, nt) >= p * ${RESOLUTION_FLOOR_HALF_PERIODS} / 2 OR nt >= cast($5 as timestamp)) THEN cast(et as long) * ${STATE_SLOTS} + st END) OVER (PARTITION BY segment_no) first_long,
     max(CASE WHEN st > ${WAN_STATE.noData} THEN datediff('u', et, nt) * ${STATE_SLOTS} + st END) OVER (PARTITION BY segment_no) longest
   FROM segmented),
relabelled AS (SELECT et, nt, p,
     CASE WHEN st = ${WAN_STATE.noData} THEN ${WAN_STATE.noData}
          WHEN first_long IS NOT NULL AND cast(et as long) * ${STATE_SLOTS} + st < first_long THEN first_long % ${STATE_SLOTS}
          WHEN first_long IS NULL THEN longest % ${STATE_SLOTS}
          ELSE st END st
   FROM anchored),
kept AS (SELECT et, nt, p, st, CASE WHEN st = ${WAN_STATE.noData} OR prev_st IS NULL OR prev_st = ${WAN_STATE.noData} OR datediff('u', et, nt) >= p * ${RESOLUTION_FLOOR_HALF_PERIODS} / 2 OR nt >= cast($5 as timestamp) THEN 1 ELSE 0 END keep
   FROM (SELECT et, nt, p, st, lag(st) OVER (ORDER BY et) prev_st FROM relabelled)),
folded AS (SELECT et, nt, p, st, sum(keep) OVER (ORDER BY et ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) state_no FROM kept),
states AS (SELECT state_no, min(et) s, max(nt) e, first(st) st, max(p) p FROM folded GROUP BY state_no ORDER BY state_no)`;
