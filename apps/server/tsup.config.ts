import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "../../dist/server",
  clean: true,
  sourcemap: true,
  dts: false,
  // Don't bundle dependencies - they're installed in node_modules. Bundling CJS
  // packages into ESM output causes esbuild to emit a require() shim that throws
  // 'Dynamic require of "..." is not supported' at runtime, so keep deps external.
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
