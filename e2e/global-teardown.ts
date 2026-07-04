import { execSync } from "node:child_process";

/**
 * Playwright global teardown: stop and remove the local `questdb-test` container.
 *
 * Only runs locally; in CI the database is a service container managed by the
 * workflow. We target the single service by name (never `down`) so a running dev
 * database and its volume are never affected.
 */
const isCI = Boolean(process.env.CI);

export default function globalTeardown(): void {
  if (isCI) {
    return;
  }

  try {
    console.log("[e2e] removing questdb-test container...");
    execSync("docker compose --profile test rm -sf questdb-test", {
      stdio: "inherit",
    });
  } catch (error) {
    console.warn(`[e2e] teardown cleanup failed (ignored): ${error}`);
  }
}
