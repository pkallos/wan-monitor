#!/usr/bin/env tsx
// Boot smoke test for the built backend bundle.
//
// Unit tests and E2E run against source (vitest / tsx), so a bundle that
// compiles cleanly but crashes at startup — e.g. esbuild emitting a
// `Dynamic require of "fs" is not supported` shim when a CJS dep is bundled
// into ESM output — passes every other gate. This runs the real, built
// `dist/server/index.js` and asserts it boots and serves `/api/health/live`
// (pure liveness, no DB required), failing loudly if the process crashes.

import { spawn } from "node:child_process";
import { existsSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtEntry = resolve(repoRoot, "dist/server/index.js");
// pnpm does not hoist the server's deps (effect, etc.) to the repo-root
// node_modules, and the built output has none of its own. Mirror the
// production container layout by linking the server's resolved node_modules
// next to the bundle so bare-specifier resolution succeeds.
const serverNodeModules = resolve(repoRoot, "apps/server/node_modules");
const linkPath = resolve(repoRoot, "dist/server/node_modules");

const PORT = Number(process.env.SMOKE_PORT ?? 3999);
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health/live`;
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 20000);
const POLL_INTERVAL_MS = 300;

function fail(message: string, logs?: string): void {
  console.error(`\n[smoke] FAIL: ${message}`);
  if (logs !== undefined) {
    console.error("[smoke] ---- backend output ----");
    console.error(logs.trim() || "(no output captured)");
    console.error("[smoke] --------------------------");
  }
  process.exitCode = 1;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  if (!existsSync(builtEntry)) {
    fail(`built entry not found at ${builtEntry} — run \`pnpm build\` first`);
    return;
  }

  let createdLink = false;
  if (!existsSync(linkPath)) {
    if (!existsSync(serverNodeModules)) {
      fail(
        `server node_modules not found at ${serverNodeModules} — run \`pnpm install\` first`
      );
      return;
    }
    symlinkSync(serverNodeModules, linkPath, "junction");
    createdLink = true;
  }

  let output = "";
  let exited = false;
  let exitInfo = "";

  const child = spawn(process.execPath, [builtEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      SERVER_HOST: "127.0.0.1",
      SERVER_PORT: String(PORT),
      // Point the DB at a closed port: the connection loop degrades
      // gracefully and must not block the HTTP listener from coming up.
      DB_HOST: "127.0.0.1",
      DB_PORT: "1",
      DB_PROTOCOL: "http",
      LOG_LEVEL: "info",
      LOG_PRETTY: "false",
      // Keep the monitor's startup ping off external hosts so the smoke test
      // stays hermetic and fast in CI. Liveness does not depend on it.
      PING_HOSTS: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (d: Buffer) => {
    output += d.toString();
  });
  child.stderr?.on("data", (d: Buffer) => {
    output += d.toString();
  });
  child.on("exit", (code, signal) => {
    exited = true;
    exitInfo = `code=${code} signal=${signal}`;
  });

  const cleanup = (): void => {
    if (!exited) {
      child.kill("SIGKILL");
    }
    if (createdLink && existsSync(linkPath)) {
      try {
        unlinkSync(linkPath);
      } catch {
        // best-effort cleanup
      }
    }
  };

  try {
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (exited) {
        fail(`backend exited before becoming healthy (${exitInfo})`, output);
        return;
      }
      try {
        const res = await fetch(HEALTH_URL);
        if (res.ok) {
          const body = (await res.json()) as { status?: string };
          if (body?.status === "ok") {
            console.log(
              `[smoke] PASS: built backend booted and served ${HEALTH_URL} (200 ok)`
            );
            return;
          }
        }
      } catch {
        // server not up yet — keep polling
      }
      await sleep(POLL_INTERVAL_MS);
    }
    fail(
      `backend did not serve a healthy ${HEALTH_URL} within ${TIMEOUT_MS}ms`,
      output
    );
  } finally {
    cleanup();
  }
}

main().catch((err: unknown) => {
  fail(`unexpected error: ${err instanceof Error ? err.stack : String(err)}`);
});
