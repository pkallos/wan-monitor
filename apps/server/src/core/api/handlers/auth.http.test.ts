import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiServiceLayer } from "@/core/api/service";
import { PingExecutor } from "@/core/monitoring/ping-executor";
import { JwtServiceLive } from "@/infrastructure/auth/jwt";
import { AuthServiceLive } from "@/infrastructure/auth/middleware";
import { ConfigService } from "@/infrastructure/config/config";
import {
  QuestDB,
  type QuestDBService,
} from "@/infrastructure/database/questdb/service";
import { SpeedTestService } from "@/infrastructure/speedtest/service";
import { makeTestAppConfig } from "@/test/config";

/**
 * HTTP-level integration tests for the auth routes (PHI-106).
 *
 * Unlike auth.test.ts / index.test.ts, which invoke handlers directly with a
 * MOCKED JwtService, these tests exercise the full app instance built by
 * `ApiServiceLayer` through `HttpRouter.toWebHandler`. Requests go in as
 * real `Request` objects and responses come back as real `Response` objects,
 * so routing, payload decoding, the Authorization middleware, and the real
 * `JwtService` signing/verification all run end-to-end.
 *
 * QuestDB is mocked (auth, not persistence, is under test); everything in the
 * auth path — config, JWT, middleware — is the real implementation. Tokens
 * used in the "valid token" cases are minted by logging in against this same
 * app, never hand-forged.
 */

const TEST_USERNAME = "admin";
const TEST_PASSWORD = "correct-horse-battery-staple";
const JWT_SECRET = "phi-106-integration-secret";

// Mock QuestDB: the metrics route only needs queryMetrics to resolve so we can
// assert that a valid token reaches a protected handler and returns 200.
const mockQuestDB: QuestDBService = {
  writeMetric: () => Effect.void,
  flush: () => Effect.void,
  queryMetrics: () => Effect.succeed([]),
  querySpeedtests: () => Effect.succeed([]),
  queryConnectivityStatus: () => Effect.succeed([]),
  queryEarliestTimestamp: () => Effect.succeed(null),
  health: () => Effect.succeed({ connected: true, uptime: 1000 }),
  close: () => Effect.void,
};

// The ping/speedtest route groups pull these services into ApiServiceLayer's
// requirement set. They are irrelevant to the auth flow, so minimal stubs keep
// the app instance constructible.
const mockPingExecutorLayer = Layer.succeed(PingExecutor, {
  executePing: (host: string) => Effect.succeed({ host, success: false }),
  executeAll: () => Effect.succeed([]),
  executeHosts: () => Effect.succeed([]),
});

const mockSpeedTestServiceLayer = Layer.succeed(SpeedTestService, {
  runTest: () =>
    Effect.succeed({
      timestamp: new Date(),
      downloadSpeed: 0,
      uploadSpeed: 0,
      latency: 0,
      jitter: 0,
    }),
});

type TestApp = {
  readonly handler: (request: Request) => Promise<Response>;
  readonly dispose: () => Promise<void>;
};

/**
 * Build a fully-wired, testable app instance through the same `ApiServiceLayer`
 * the production server uses. `authPassword` controls whether authentication is
 * required (an empty string disables it, matching ConfigService semantics), and
 * `jwtSecret` lets a test mint tokens the app under test will reject.
 */
const makeTestApp = (
  authPassword: string,
  jwtSecret: string = JWT_SECRET
): TestApp => {
  const ConfigLayer = Layer.succeed(
    ConfigService,
    makeTestAppConfig({
      auth: {
        username: TEST_USERNAME,
        password: authPassword,
        jwtSecret,
        jwtExpiresIn: "1h",
      },
    })
  );

  const JwtLayer = JwtServiceLive.pipe(Layer.provide(ConfigLayer));
  const AuthLayer = AuthServiceLive.pipe(
    Layer.provide(Layer.mergeAll(ConfigLayer, JwtLayer))
  );

  const MockServicesLayer = Layer.mergeAll(
    ConfigLayer,
    JwtLayer,
    Layer.succeed(QuestDB, mockQuestDB),
    mockPingExecutorLayer,
    mockSpeedTestServiceLayer
  );

  const ProvidedApiLayer = ApiServiceLayer.pipe(
    Layer.provide(Layer.mergeAll(MockServicesLayer, AuthLayer)),
    // Platform services (FileSystem, Path, Etag.Generator) and a router
    // instance that HttpApiBuilder needs at the build-time layer level.
    Layer.provide(HttpServer.layerServices),
    Layer.provide(HttpRouter.layer)
  );

  // HttpApiBuilder tracks each handler's own leftover requirements as a
  // per-request `Request<"Requires", _>` channel, not an ordinary Layer
  // dependency, so `Layer.provide` above can't discharge it — it's built to
  // be satisfied per call instead, via toWebHandler's second `context`
  // argument. Build that context once here, from the same mock/config/jwt
  // layers, rather than threading it through every `post`/`get` call site.
  const requestContext = MockServicesLayer.pipe(
    Layer.build,
    Effect.scoped,
    Effect.runSync
  );

  const { handler, dispose } = HttpRouter.toWebHandler(ProvidedApiLayer);
  return {
    handler: (request: Request) => handler(request, requestContext),
    dispose,
  };
};

const post = (app: TestApp, path: string, body: unknown): Promise<Response> =>
  app.handler(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

const get = (app: TestApp, path: string, token?: string): Promise<Response> =>
  app.handler(
    new Request(`http://localhost${path}`, {
      method: "GET",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  );

/**
 * Log in against the app and return the real JWT it signs. Fails loudly if
 * login did not return 200 so downstream "valid token" assertions never run
 * against a bogus token.
 */
const loginForToken = async (app: TestApp): Promise<string> => {
  const res = await post(app, "/api/auth/login", {
    username: TEST_USERNAME,
    password: TEST_PASSWORD,
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  return body.token;
};

describe("Auth HTTP integration (real JWT flow)", () => {
  describe("with authentication enabled", () => {
    let app: TestApp;

    beforeEach(() => {
      app = makeTestApp(TEST_PASSWORD);
    });

    afterEach(async () => {
      await app.dispose();
    });

    describe("POST /api/auth/login", () => {
      it("returns 200 with a token and expiry for valid credentials", async () => {
        const res = await post(app, "/api/auth/login", {
          username: TEST_USERNAME,
          password: TEST_PASSWORD,
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          token: string;
          expiresAt: string | null;
          username: string;
        };
        expect(typeof body.token).toBe("string");
        expect(body.token.split(".")).toHaveLength(3); // real signed JWT
        expect(body.expiresAt).not.toBeNull();
        expect(new Date(body.expiresAt as string).getTime()).toBeGreaterThan(
          Date.now()
        );
        expect(body.username).toBe(TEST_USERNAME);
      });

      it("returns 401 for invalid credentials", async () => {
        const res = await post(app, "/api/auth/login", {
          username: TEST_USERNAME,
          password: "wrong-password",
        });

        expect(res.status).toBe(401);
      });

      it("returns 400 when required fields are missing", async () => {
        const res = await post(app, "/api/auth/login", {
          username: TEST_USERNAME,
        });

        expect(res.status).toBe(400);
      });
    });

    describe("GET /api/auth/me", () => {
      it("returns 200 and user info for a real signed token", async () => {
        const token = await loginForToken(app);

        const res = await get(app, "/api/auth/me", token);

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          username: string;
          authenticated: boolean;
        };
        expect(body.username).toBe(TEST_USERNAME);
        expect(body.authenticated).toBe(true);
      });

      it("returns 401 when no token is provided", async () => {
        const res = await get(app, "/api/auth/me");

        expect(res.status).toBe(401);
      });

      it("surfaces the auth failure reason in the 401 body", async () => {
        const res = await get(app, "/api/auth/me");

        expect(res.status).toBe(401);
        const body = (await res.json()) as { _tag: string; message: string };
        expect(body._tag).toBe("Unauthorized");
        expect(body.message).toBe("Authorization header required");
      });
    });

    describe("GET /api/auth/status", () => {
      it("reports authRequired=true when a password is configured", async () => {
        const res = await get(app, "/api/auth/status");

        expect(res.status).toBe(200);
        const body = (await res.json()) as { authRequired: boolean };
        expect(body.authRequired).toBe(true);
      });
    });

    describe("protected route GET /api/metrics", () => {
      it("returns 401 without a token", async () => {
        const res = await get(app, "/api/metrics");

        expect(res.status).toBe(401);
      });

      it("returns 200 with a real signed token", async () => {
        const token = await loginForToken(app);

        const res = await get(app, "/api/metrics", token);

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          data: unknown[];
          meta: { count: number };
        };
        expect(Array.isArray(body.data)).toBe(true);
        expect(body.meta.count).toBe(0);
      });

      it("returns 401 for a token signed with a different secret", async () => {
        // Mint a real JWT from an app configured with a different secret; the
        // app under test must reject it on verification.
        const otherApp = makeTestApp(
          TEST_PASSWORD,
          "a-totally-different-secret"
        );
        const foreignToken = await loginForToken(otherApp);
        await otherApp.dispose();

        const res = await get(app, "/api/metrics", foreignToken);

        expect(res.status).toBe(401);
      });
    });
  });

  describe("with authentication disabled", () => {
    let app: TestApp;

    beforeEach(() => {
      app = makeTestApp("");
    });

    afterEach(async () => {
      await app.dispose();
    });

    it("GET /api/auth/me resolves the anonymous user without a token", async () => {
      const res = await get(app, "/api/auth/me");

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        username: string;
        authenticated: boolean;
      };
      expect(body.username).toBe("anonymous");
      expect(body.authenticated).toBe(false);
    });

    it("GET /api/auth/status reports authRequired=false", async () => {
      const res = await get(app, "/api/auth/status");

      expect(res.status).toBe(200);
      const body = (await res.json()) as { authRequired: boolean };
      expect(body.authRequired).toBe(false);
    });
  });
});
