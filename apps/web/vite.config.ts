import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { foldkit } from "@foldkit/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Matches the server's own SERVER_PORT default (config.ts) so the dev proxy
// still finds the backend when SERVER_PORT is overridden.
const serverPort = process.env.SERVER_PORT ?? "3001";
const devPort = process.env.PORT ? Number(process.env.PORT) : 3000;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), foldkit()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@shared": resolve(__dirname, "../../packages/shared/src"),
    },
  },
  build: {
    outDir: resolve(__dirname, "../../dist/web"),
    emptyOutDir: true,
  },
  server: {
    port: devPort,
    host: true,
    proxy: {
      "/api": {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 3000,
    host: true,
  },
});
