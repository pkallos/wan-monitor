import { execSync } from "node:child_process";
import { seedTestDatabase, waitForQuestDb } from "./fixtures/seed";

/**
 * Playwright global setup: prepare the isolated test QuestDB and seed it.
 *
 * Locally we boot the `questdb-test` compose service (profile `test`). In CI the
 * database is provided as a service container, so we skip the boot and only wait
 * + seed. This keeps `pnpm test:e2e` working on a fresh checkout with no shell
 * wrapper: `playwright test` handles the whole lifecycle.
 */
const TEST_DB_URL = process.env.E2E_DB_URL ?? "http://localhost:9100";
const isCI = Boolean(process.env.CI);

export default async function globalSetup(): Promise<void> {
  if (!isCI) {
    // eslint-disable-next-line no-console
    console.log("[e2e] starting questdb-test container...");
    execSync("docker compose --profile test up -d questdb-test", {
      stdio: "inherit",
    });
  }

  console.log(`[e2e] waiting for QuestDB at ${TEST_DB_URL}...`);
  await waitForQuestDb(TEST_DB_URL);

  console.log("[e2e] seeding deterministic test data...");
  await seedTestDatabase(TEST_DB_URL);

  console.log("[e2e] test database ready.");
}
