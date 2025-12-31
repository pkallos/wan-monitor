import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server/index.ts'],
  format: ['esm'],
  target: 'node24',
  outDir: 'dist/server',
  clean: true,
  sourcemap: true,
  dts: false,
  // Don't bundle dependencies - they're installed in node_modules
  external: [
    '@questdb/nodejs-client',
    '@fastify/cors',
    'fastify',
    'effect',
    'ping',
  ],
  esbuildOptions(options) {
    // Handle @/ path alias
    options.alias = {
      '@': './src',
    };
  },
});
