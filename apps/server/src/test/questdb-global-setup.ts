import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Vitest global setup for the integration suite.
 *
 * Boots the isolated `questdb-test` compose service (profile `test`) so the
 * QUESTDB_AVAILABLE-gated tests run against a real database instead of skipping.
 * Connection env (DB_HOST/DB_PORT/DB_PG_PORT/QUESTDB_AVAILABLE) is provided by
 * vitest.config.ts (integration mode) via `test.env`; this file only manages
 * the container lifecycle.
 *
 * Locally we start/stop the container; in CI the database is a service
 * container managed by the workflow, so we only wait for readiness. Teardown
 * targets the single service by name (never `down`) so a running dev database
 * is never affected.
 */
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);
const DB_URL = "http://localhost:9100";
const isCI = Boolean(process.env.CI);

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const waitForQuestDb = async (timeoutMs = 60_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `${DB_URL}/exec?query=${encodeURIComponent("SELECT 1")}`
      );
      if (res.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(1000);
  }
  throw new Error(
    `QuestDB test instance not ready after ${timeoutMs}ms: ${lastError}`
  );
};

export async function setup(): Promise<void> {
  if (!isCI) {
    execSync("docker compose --profile test up -d questdb-test", {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
  }
  await waitForQuestDb();
}

export function teardown(): void {
  if (isCI) {
    return;
  }
  try {
    execSync("docker compose --profile test rm -sf questdb-test", {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
  } catch {
    // Best-effort cleanup; ignore failures so a teardown error never masks
    // a real test failure.
  }
}
