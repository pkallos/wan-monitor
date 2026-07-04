import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Integration mode (opt-in via `pnpm test:integration`) boots an isolated
// QuestDB and unskips the QUESTDB_AVAILABLE-gated suites. The default
// `pnpm test` (and CI's coverage job, which supplies its own DB) leave this
// unset and stay docker-free, so integration tests skip cleanly.
const integrationMode = process.env.VITEST_INTEGRATION === "true";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@shared": resolve(__dirname, "../../packages/shared/src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    testTimeout: 15000, // 15 seconds for integration tests
    // Integration tests share a single QuestDB `network_metrics` table and
    // isolate themselves via TRUNCATE in setup/teardown. Running test files in
    // parallel lets one file's TRUNCATE wipe another file's freshly-seeded rows
    // between seed and query, producing flaky "expected 0 to be greater than 0"
    // failures. Serialize test files so the shared table has a single writer.
    fileParallelism: false,
    // In integration mode, boot/seed the isolated test DB and point the client
    // at it (REST/ILP on 9100, PgWire on 8912).
    globalSetup: integrationMode
      ? ["./src/test/questdb-global-setup.ts"]
      : undefined,
    env: integrationMode
      ? {
          QUESTDB_AVAILABLE: "true",
          DB_HOST: "localhost",
          DB_PORT: "9100",
          DB_PG_PORT: "8912",
          DB_PROTOCOL: "http",
        }
      : undefined,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: ["node_modules/", "**/*.d.ts", "**/*.config.*", "**/test/**"],
    },
  },
});
