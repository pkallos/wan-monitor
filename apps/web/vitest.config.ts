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
    // Date labels render through `toLocaleDateString` in the viewer's locale,
    // so assertions on them are only deterministic once the worker's ICU
    // default is pinned.
    env: { LC_ALL: "en-US", LANG: "en-US" },
    environment: "happy-dom",
    setupFiles: "./src/vitest-setup.ts",
    include: ["src/**/*.test.ts"],
    server: {
      deps: {
        inline: ["foldkit", "@foldkit/ui", "echarts"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: [
        "node_modules/",
        "**/*.d.ts",
        "**/*.config.*",
        "src/entry.ts",
        "src/vite-env.d.ts",
        "src/vitest-setup.ts",
      ],
    },
  },
});
