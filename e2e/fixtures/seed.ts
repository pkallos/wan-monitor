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
 */

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
].join(", ");

const TABLE = "network_metrics";

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
  await exec(
    baseUrl,
    `CREATE TABLE ${TABLE} (
      timestamp TIMESTAMP,
      source SYMBOL,
      host SYMBOL,
      latency DOUBLE,
      jitter DOUBLE,
      packet_loss DOUBLE,
      connectivity_status STRING,
      download_bandwidth LONG,
      upload_bandwidth LONG,
      server_location STRING,
      isp STRING,
      external_ip STRING,
      internal_ip STRING
    ) TIMESTAMP(timestamp) PARTITION BY DAY WAL;`
  );
};

const isoAt = (epochMs: number): string =>
  new Date(epochMs).toISOString().replace("Z", "000Z"); // ms -> microsecond precision

/** 96 ping rows at 15-minute intervals across the last 24h, ending at now. */
const buildPingRows = (nowMs: number): string[] => {
  const rows: string[] = [];
  for (let i = 0; i < 96; i++) {
    const ts = isoAt(nowMs - i * 15 * 60 * 1000);
    const latency = 20 + (i % 30); // 20-49ms
    const jitterTenths = i % 50;
    const jitter = `${Math.floor(jitterTenths / 10)}.${jitterTenths % 10}`; // 0.0-4.9
    const packetLoss = i % 20 === 0 ? i % 5 : 0;
    const connectivity = i !== 0 && i % 50 === 0 ? "down" : "up";
    rows.push(
      `('${ts}', 'ping', '8.8.8.8', ${latency}, ${jitter}, ${packetLoss}, '${connectivity}', null, null, null, null, null, null)`
    );
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
      `('${ts}', 'speedtest', 'speedtest.net', null, null, null, 'up', ${download}, ${upload}, 'San Francisco, CA', 'TestISP', '1.2.3.4', '192.168.1.100')`
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
 * Seed a fresh, deterministic dataset: 96 ping + 6 speedtest metrics spanning
 * the last 24 hours. Resets the schema first so the result is idempotent.
 */
export const seedTestDatabase = async (baseUrl: string): Promise<void> => {
  const nowMs = Date.now();
  const pingRows = buildPingRows(nowMs);
  const speedtestRows = buildSpeedtestRows(nowMs);

  await resetSchema(baseUrl);
  await insertRows(baseUrl, pingRows);
  await insertRows(baseUrl, speedtestRows);
  await waitForRowCount(baseUrl, pingRows.length + speedtestRows.length);
};
