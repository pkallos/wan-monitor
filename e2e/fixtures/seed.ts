/**
 * Deterministic QuestDB seeding for E2E tests.
 *
 * Runs from Playwright's globalSetup (TypeScript, cross-platform) instead of a
 * shell script, and talks to QuestDB's HTTP `/exec` endpoint directly so it has
 * no dependency on the server's Effect runtime.
 *
 * Data is anchored to "now" (offsets back from the current time) so the most
 * recent ping/speedtest always fall inside the dashboard's now-minus-24h query
 * window, regardless of what time of day the suite runs.
 *
 * The server migrates the metrics table before globalSetup runs the seed. The
 * seed then recreates it from `buildCreateTableSql()`, so the table carries
 * every column through `duration_ms` and matches the migration ledger.
 */

import {
  buildCreateTableSql,
  NETWORK_METRICS_TABLE,
} from "@wan-monitor/shared/db-schema";

// Value tuples in buildPingRows/buildSpeedtestRows are positioned to match this
// exact column order.
const COLUMNS = [
  "timestamp",
  "source",
  "host",
  "latency",
  "jitter",
  "packet_loss",
  "connectivity_status",
  "download_bandwidth",
  "upload_bandwidth",
  "server_location",
  "isp",
  "external_ip",
  "internal_ip",
  "duration_ms",
].join(", ");

const TABLE = NETWORK_METRICS_TABLE;

interface ExecResponse {
  readonly error?: string;
  readonly dataset?: ReadonlyArray<ReadonlyArray<number>>;
}

/** Run a single SQL statement via the QuestDB REST API, failing loudly. */
const exec = async (baseUrl: string, query: string): Promise<ExecResponse> => {
  const response = await fetch(
    `${baseUrl}/exec?query=${encodeURIComponent(query)}`
  );
  const body = (await response.json()) as ExecResponse;
  if (!response.ok || body.error) {
    throw new Error(
      `QuestDB exec failed (${response.status}): ${body.error ?? "unknown"} :: ${query.slice(0, 120)}`
    );
  }
  return body;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Poll the REST API until QuestDB answers a trivial query, or time out. */
export const waitForQuestDb = async (
  baseUrl: string,
  timeoutMs = 60_000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await exec(baseUrl, "SELECT 1");
      return;
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }
  throw new Error(`QuestDB not ready after ${timeoutMs}ms: ${lastError}`);
};

/**
 * Drop and recreate the metrics table so each run starts from a known-empty
 * state, independent of any data left in the (persistent) test volume.
 */
export const resetSchema = async (baseUrl: string): Promise<void> => {
  await exec(baseUrl, `DROP TABLE IF EXISTS ${TABLE}`);
  // Recreate from the canonical schema so E2E, CI, integration tests, and the
  // server migrations all share one identical table definition (no drift).
  await exec(baseUrl, buildCreateTableSql());
};

const isoAt = (epochMs: number): string =>
  new Date(epochMs).toISOString().replace("Z", "000Z"); // ms -> microsecond precision

const SEEDED_HOSTS = ["8.8.8.8", "1.1.1.1"] as const;

const CYCLE_MS = 15 * 60 * 1000;
/** The stamps of consecutive hosts in a cycle differ by a few seconds. */
const HOST_STAGGER_MS = 4000;
/** Cycles at or after this index carry no `duration_ms`, as rows written before the column existed do. */
const FIRST_UNTIMED_CYCLE = 48;
const ANSWERED_DURATION_MS = 2400;
const FAILED_DURATION_MS = 8000;

/** Cycles (counted back from now, 15 minutes apart) in which every host fails. */
const OUTAGE_CYCLES = new Set([30, 31, 32, 33]);
/** Cycles in which one host answers but drops 30% of its packets: degraded, not down. */
const DEGRADED_CYCLES = new Set([60, 61]);

/** When a host's ping of a cycle started: cycles count back from now, and each later host starts a little earlier. */
export const pingStampMs = (
  nowMs: number,
  cycle: number,
  hostIndex = 0
): number => nowMs - cycle * CYCLE_MS - hostIndex * HOST_STAGGER_MS;

/** The first cycle of the seeded outage, which is where the outage log says it began. */
export const SEEDED_OUTAGE_FIRST_CYCLE = Math.max(...OUTAGE_CYCLES);

const NOW_ENV = "E2E_SEED_NOW_MS";

/** Records the seed's "now" for the test workers, which start after globalSetup and inherit its environment. */
const publishSeedNow = (nowMs: number): void => {
  process.env[NOW_ENV] = String(nowMs);
};

/** The "now" the seed was anchored to. */
export const seededNowMs = (): number => {
  const nowMs = Number(process.env[NOW_ENV]);
  if (!Number.isFinite(nowMs)) {
    throw new Error(`${NOW_ENV} is unset: globalSetup has not seeded`);
  }
  return nowMs;
};

/**
 * 96 cycles at 15-minute intervals across the last 24h, ending at now, one row
 * per host per cycle. The seeded server runs at a 15-minute ping interval (see
 * playwright.config.ts), so each host's rows read as evenly spaced. Three
 * incidents sit inside the window: a one-hour outage across both hosts (cycles
 * 30 to 33), a 15-minute outage (cycle 50) and a 30-minute degraded period on
 * one host (cycles 60 and 61). The incidents card and the ribbon have
 * something to show.
 */
const buildPingRows = (nowMs: number): string[] => {
  const rows: string[] = [];
  for (let i = 0; i < 96; i++) {
    for (const [hostIndex, host] of SEEDED_HOSTS.entries()) {
      const ts = isoAt(pingStampMs(nowMs, i, hostIndex));
      const isFailed = OUTAGE_CYCLES.has(i);
      const durationMs =
        i >= FIRST_UNTIMED_CYCLE
          ? "null"
          : isFailed
            ? FAILED_DURATION_MS
            : ANSWERED_DURATION_MS;
      if (isFailed) {
        rows.push(
          `('${ts}', 'ping', '${host}', null, null, 100, 'down', null, null, null, null, null, null, ${durationMs})`
        );
        continue;
      }
      const latency = 20 + (i % 30) + hostIndex * 4; // 20-53ms
      const jitterTenths = i % 50;
      const jitter = `${Math.floor(jitterTenths / 10)}.${jitterTenths % 10}`; // 0.0-4.9
      const isDegraded = DEGRADED_CYCLES.has(i) && hostIndex === 0;
      const packetLoss = isDegraded ? 30 : i % 20 === 0 ? i % 5 : 0;
      const connectivity = i !== 0 && i % 50 === 0 ? "down" : "up";
      rows.push(
        `('${ts}', 'ping', '${host}', ${latency}, ${jitter}, ${packetLoss}, '${connectivity}', null, null, null, null, null, null, ${durationMs})`
      );
    }
  }
  return rows;
};

/** 6 speedtest rows at 4-hour intervals across the last 24h, ending at now. */
const buildSpeedtestRows = (nowMs: number): string[] => {
  const rows: string[] = [];
  for (let i = 0; i < 6; i++) {
    const ts = isoAt(nowMs - i * 4 * 60 * 60 * 1000);
    const download = (100 + i * 5) * 1_000_000; // 100-125 Mbps in bps
    const upload = (10 + i * 2) * 1_000_000; // 10-20 Mbps in bps
    rows.push(
      `('${ts}', 'speedtest', 'speedtest.net', null, null, null, 'up', ${download}, ${upload}, 'San Francisco, CA', 'TestISP', '1.2.3.4', '192.168.1.100', null)`
    );
  }
  return rows;
};

/** Insert rows in chunks to keep each GET request URL comfortably small. */
const insertRows = async (
  baseUrl: string,
  rows: readonly string[],
  chunkSize = 40
): Promise<void> => {
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    await exec(
      baseUrl,
      `INSERT INTO ${TABLE} (${COLUMNS}) VALUES ${chunk.join(",")};`
    );
  }
};

/** Poll until QuestDB has committed at least `expected` rows (ILP/WAL is async). */
const waitForRowCount = async (
  baseUrl: string,
  expected: number,
  timeoutMs = 15_000
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let count = 0;
  while (Date.now() < deadline) {
    const body = await exec(baseUrl, `SELECT count() FROM ${TABLE}`);
    count = body.dataset?.[0]?.[0] ?? 0;
    if (count >= expected) {
      return;
    }
    await sleep(200);
  }
  throw new Error(
    `QuestDB committed ${count} rows, expected at least ${expected}`
  );
};

/**
 * Seed a fresh, deterministic dataset: 96 ping cycles (two hosts each) and 6
 * speedtest metrics spanning the last 24 hours. Resets the schema first so the
 * result is idempotent, and publishes the seed's "now" for `seededNowMs`.
 */
export const seedTestDatabase = async (baseUrl: string): Promise<void> => {
  const nowMs = Date.now();
  publishSeedNow(nowMs);
  const pingRows = buildPingRows(nowMs);
  const speedtestRows = buildSpeedtestRows(nowMs);

  await resetSchema(baseUrl);
  await insertRows(baseUrl, pingRows);
  await insertRows(baseUrl, speedtestRows);
  await waitForRowCount(baseUrl, pingRows.length + speedtestRows.length);
};
