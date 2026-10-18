#!/usr/bin/env tsx
// Boot smoke test for the built backend bundle.
//
// Unit tests and E2E run against source (vitest / tsx), so a bundle that
// compiles cleanly but crashes at startup — e.g. esbuild emitting a
// `Dynamic require of "fs" is not supported` shim when a CJS dep is bundled
// into ESM output — passes every other gate. This runs the real, built
// `dist/server/index.js` and asserts it boots and serves `/api/health/live`
// (pure liveness, no DB required), failing loudly if the process crashes.
// It then checks the shutdown contract: SIGTERM runs the scope finalizers and
// exits, and a layer that fails at startup exits non-zero.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, symlinkSync, unlinkSync } from "node:fs";
import { createServer, type Server } from "node:net";
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

interface Backend {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly exit: Promise<{ code: number | null; signal: string | null }>;
}

// Every database and ping key is set explicitly so neither the caller's
// environment nor a `.env.local` can point the test at a real QuestDB or host.
// The long ping train delays the first speed test until the phases finish.
function startBackend(port: number): Backend {
  let output = "";
  const child = spawn(process.execPath, [builtEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      SERVER_HOST: "127.0.0.1",
      SERVER_PORT: String(port),
      // Point the DB at a closed port: the connection loop degrades
      // gracefully and must not block the HTTP listener from coming up.
      DB_HOST: "127.0.0.1",
      DB_PORT: "1",
      DB_PG_PORT: "1",
      DB_PROTOCOL: "http",
      LOG_LEVEL: "info",
      LOG_PRETTY: "false",
      // Keep the monitor's startup ping off external hosts so the smoke test
      // stays hermetic and fast in CI. Liveness does not depend on it.
      PING_HOSTS: "127.0.0.1",
      PING_TRAIN_COUNT: "40",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (d: Buffer) => {
    output += d.toString();
  });
  child.stderr?.on("data", (d: Buffer) => {
    output += d.toString();
  });
  const exit = new Promise<{ code: number | null; signal: string | null }>(
    (resolveExit) => {
      child.on("close", (code, signal) => resolveExit({ code, signal }));
    }
  );
  return { child, output: () => output, exit };
}

const settled = async <T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T | undefined> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(undefined), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

async function waitForHealthy(backend: Backend): Promise<string | undefined> {
  let exited = false;
  backend.exit.then(() => {
    exited = true;
  });
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) {
      return "backend exited before becoming healthy";
    }
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body?.status === "ok") {
          return undefined;
        }
      }
    } catch {
      // server not up yet; keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return `backend did not serve a healthy ${HEALTH_URL} within ${TIMEOUT_MS}ms`;
}

async function checkBootAndSigterm(): Promise<void> {
  const backend = startBackend(PORT);
  try {
    const unhealthy = await waitForHealthy(backend);
    if (unhealthy !== undefined) {
      fail(unhealthy, backend.output());
      return;
    }
    console.log(
      `[smoke] PASS: built backend booted and served ${HEALTH_URL} (200 ok)`
    );

    backend.child.kill("SIGTERM");
    const exit = await settled(backend.exit, TIMEOUT_MS);
    if (exit === undefined) {
      fail(
        `backend did not exit within ${TIMEOUT_MS}ms of SIGTERM`,
        backend.output()
      );
    } else if (exit.signal !== null || exit.code !== 130) {
      fail(
        `backend should exit with code 130 after SIGTERM (code=${exit.code} signal=${exit.signal})`,
        backend.output()
      );
    } else if (!backend.output().includes("QuestDB connection closed")) {
      fail("SIGTERM did not run the QuestDB finalizer", backend.output());
    } else {
      console.log(
        "[smoke] PASS: SIGTERM ran the finalizers and exited with code 130"
      );
    }
  } finally {
    backend.child.kill("SIGKILL");
  }
}

async function checkStartupFailureExitsNonZero(): Promise<void> {
  const blocker: Server = createServer();
  await new Promise<void>((resolveListen) =>
    blocker.listen(0, "127.0.0.1", resolveListen)
  );
  const address = blocker.address();
  const heldPort = typeof address === "object" && address ? address.port : 0;
  const backend = startBackend(heldPort);
  try {
    const exit = await settled(backend.exit, TIMEOUT_MS);
    if (exit === undefined) {
      fail(
        `backend kept running after its HTTP port was taken (${TIMEOUT_MS}ms)`,
        backend.output()
      );
    } else if (exit.code === null || exit.code === 0) {
      fail(
        `backend should exit non-zero when a layer fails at startup (code=${exit.code} signal=${exit.signal})`,
        backend.output()
      );
    } else if (!backend.output().includes("EADDRINUSE")) {
      fail("startup failure was not reported in the output", backend.output());
    } else {
      console.log(
        `[smoke] PASS: startup failure exited with code ${exit.code}`
      );
    }
  } finally {
    backend.child.kill("SIGKILL");
    blocker.close();
  }
}

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

  try {
    await checkBootAndSigterm();
    await checkStartupFailureExitsNonZero();
  } finally {
    if (createdLink && existsSync(linkPath)) {
      try {
        unlinkSync(linkPath);
      } catch {
        // best-effort cleanup
      }
    }
  }
}

main().catch((err: unknown) => {
  fail(`unexpected error: ${err instanceof Error ? err.stack : String(err)}`);
});
