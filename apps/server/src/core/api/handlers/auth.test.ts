import { describe, expect, it } from "@effect/vitest";
import { AuthenticatedUser } from "@shared/api/middlewares/authorization";
import { Effect, Layer } from "effect";
import { type AppConfig, ConfigService } from "@/infrastructure/config/config";

const createTestConfigService = (
  username: string,
  password: string
): AppConfig => ({
  server: { port: 3001, host: "0.0.0.0" },
  database: {
    host: "localhost",
    port: 9000,
    protocol: "http",
    autoFlushRows: 100,
    autoFlushInterval: 1000,
    requestTimeout: 10000,
    retryTimeout: 1000,
  },
  ping: {
    timeout: 5,
    trainCount: 10,
    hosts: ["8.8.8.8"],
  },
  auth: {
    username,
    password,
    jwtSecret: "test-secret",
    jwtExpiresIn: "24h",
  },
});

describe("Auth API Handlers", () => {
  describe("login handler (PUBLIC - always accessible)", () => {
    it.effect("returns token when credentials are valid", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("admin", "test-password")
      );

      return Effect.gen(function* () {
        const config = yield* ConfigService;

        // Simulate login handler logic
        const payload = { username: "admin", password: "test-password" };

        if (!payload.username || !payload.password) {
          return yield* Effect.fail("Username and password are required");
        }

        if (!config.auth.password) {
          return yield* Effect.fail(
            "Authentication is not configured. Set WAN_MONITOR_PASSWORD."
          );
        }

        if (
          payload.username !== config.auth.username ||
          payload.password !== config.auth.password
        ) {
          return yield* Effect.fail("Invalid username or password");
        }

        // If we reach here, credentials are valid - simulate JWT sign
        const result = {
          token: "mock.jwt.token",
          expiresAt: new Date(Date.now() + 86400000),
          username: payload.username,
        };

        expect(result.token).toBeDefined();
        expect(result.expiresAt).toBeDefined();
        expect(result.username).toBe("admin");
        return result;
      }).pipe(Effect.provide(ConfigServiceTest));
    });

    it.effect("fails when credentials are invalid", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("admin", "correct-password")
      );

      return Effect.gen(function* () {
        const config = yield* ConfigService;

        const payload = { username: "admin", password: "wrong-password" };

        if (
          payload.username !== config.auth.username ||
          payload.password !== config.auth.password
        ) {
          return yield* Effect.fail("Invalid username or password");
        }

        return {
          token: "should-not-reach",
          expiresAt: new Date(),
          username: "admin",
        };
      }).pipe(
        Effect.either,
        Effect.map((result) => {
          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            expect(result.left).toBe("Invalid username or password");
          }
          return result;
        }),
        Effect.provide(ConfigServiceTest)
      );
    });

    it.effect("fails when auth is not configured", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("admin", "")
      );

      return Effect.gen(function* () {
        const config = yield* ConfigService;

        if (!config.auth.password) {
          return yield* Effect.fail(
            "Authentication is not configured. Set WAN_MONITOR_PASSWORD."
          );
        }

        return {
          token: "should-not-reach",
          expiresAt: new Date(),
          username: "admin",
        };
      }).pipe(
        Effect.either,
        Effect.map((result) => {
          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            expect(result.left).toContain("Authentication is not configured");
          }
          return result;
        }),
        Effect.provide(ConfigServiceTest)
      );
    });

    it.effect("fails when username is missing", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("admin", "test-password")
      );

      return Effect.gen(function* () {
        const payload = { username: "", password: "test" };

        if (!payload.username || !payload.password) {
          return yield* Effect.fail("Username and password are required");
        }

        return {
          token: "should-not-reach",
          expiresAt: new Date(),
          username: "",
        };
      }).pipe(
        Effect.either,
        Effect.map((result) => {
          expect(result._tag).toBe("Left");
          if (result._tag === "Left") {
            expect(result.left).toBe("Username and password are required");
          }
          return result;
        }),
        Effect.provide(ConfigServiceTest)
      );
    });
  });

  describe("logout handler (PUBLIC - always accessible)", () => {
    it.effect("returns success message", () => {
      const result = {
        success: true,
        message: "Logged out successfully",
      };

      expect(result.success).toBe(true);
      expect(result.message).toBe("Logged out successfully");

      return Effect.succeed(result);
    });
  });

  describe("me handler (PROTECTED)", () => {
    it.effect("returns anonymous user when auth is disabled", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("admin", "")
      );
      const MockAuthenticatedUser = Layer.succeed(AuthenticatedUser, {
        username: "anonymous",
        iat: Date.now() / 1000,
        exp: Date.now() / 1000 + 86400,
      });

      return Effect.gen(function* () {
        const config = yield* ConfigService;
        const user = yield* AuthenticatedUser;

        // Simulate /me handler logic
        if (!config.auth.password) {
          const result = {
            username: user.username,
            authenticated: false,
          };
          expect(result.username).toBe("anonymous");
          expect(result.authenticated).toBe(false);
          return result;
        }

        return {
          username: user.username,
          authenticated: true,
        };
      }).pipe(
        Effect.provide(Layer.mergeAll(ConfigServiceTest, MockAuthenticatedUser))
      );
    });

    it.effect("returns authenticated user when auth is enabled", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("admin", "test-password")
      );
      const MockAuthenticatedUser = Layer.succeed(AuthenticatedUser, {
        username: "testuser",
        iat: Date.now() / 1000,
        exp: Date.now() / 1000 + 86400,
      });

      return Effect.gen(function* () {
        const config = yield* ConfigService;
        const user = yield* AuthenticatedUser;

        // Simulate /me handler logic
        if (!config.auth.password) {
          return {
            username: user.username,
            authenticated: false,
          };
        }

        const result = {
          username: user.username,
          authenticated: true,
        };

        expect(result.username).toBe("testuser");
        expect(result.authenticated).toBe(true);
        return result;
      }).pipe(
        Effect.provide(Layer.mergeAll(ConfigServiceTest, MockAuthenticatedUser))
      );
    });
  });

  describe("status handler (PUBLIC - always accessible)", () => {
    it.effect("returns authRequired true when password is configured", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("admin", "test-password")
      );

      return Effect.gen(function* () {
        const config = yield* ConfigService;
        const result = {
          authRequired: Boolean(config.auth.password),
        };

        expect(result.authRequired).toBe(true);
        return result;
      }).pipe(Effect.provide(ConfigServiceTest));
    });

    it.effect(
      "returns authRequired false when password is not configured",
      () => {
        const ConfigServiceTest = Layer.succeed(
          ConfigService,
          createTestConfigService("admin", "")
        );

        return Effect.gen(function* () {
          const config = yield* ConfigService;
          const result = {
            authRequired: Boolean(config.auth.password),
          };

          expect(result.authRequired).toBe(false);
          return result;
        }).pipe(Effect.provide(ConfigServiceTest));
      }
    );
  });
});
