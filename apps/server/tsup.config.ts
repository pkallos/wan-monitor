import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "../../dist/server",
  clean: true,
  sourcemap: true,
  dts: false,
  // Don't bundle dependencies - they're installed in node_modules
  // Exception: dotenv is bundled to avoid module resolution issues with E2E tests
  noExternal: ["dotenv"],
  external: [
    "@questdb/nodejs-client",
    "@fastify/cors",
    "fastify",
    "effect",
    "ping",
  ],
  esbuildOptions(options) {
    // Handle @/ path alias
    options.alias = {
      "@": "./src",
    };
  },
});
