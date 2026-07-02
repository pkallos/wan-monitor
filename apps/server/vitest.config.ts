import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: ["node_modules/", "**/*.d.ts", "**/*.config.*", "**/test/**"],
    },
  },
});
