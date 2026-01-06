import { describe, expect, it } from "@effect/vitest";
import { AuthenticatedUser } from "@shared/api/middlewares/authorization";
import { Effect, Layer } from "effect";
import {
  loginHandler,
  logoutHandler,
  meHandler,
  statusHandler,
} from "@/core/api/handlers/auth";
import { JwtService } from "@/infrastructure/auth/jwt";
import { type AppConfig, ConfigService } from "@/infrastructure/config/config";

const createMockConfig = (username: string, password: string): AppConfig => ({
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

const createMockJwtService = () => ({
  sign: (_username: string) =>
    Effect.succeed({
      token: "mock.jwt.token",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    }),
  verify: (_token: string) =>
    Effect.succeed({
      username: "admin",
      iat: Date.now(),
      exp: Date.now() + 86400000,
    }),
  decode: (_token: string) =>
    Effect.succeed({
      username: "admin",
      iat: Date.now(),
      exp: Date.now() + 86400000,
    }),
});

describe("Auth Handlers", () => {
  describe("login", () => {
    it.effect("returns token and user info with valid credentials", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createMockConfig("admin", "test-password")
      );
      const JwtServiceTest = Layer.succeed(JwtService, createMockJwtService());
      const TestLayers = Layer.mergeAll(ConfigServiceTest, JwtServiceTest);

      return Effect.gen(function* () {
        const result = yield* loginHandler({
          payload: { username: "admin", password: "test-password" },
        });

        expect(result.token).toBe("mock.jwt.token");
        expect(result.username).toBe("admin");
        expect(result.expiresAt).toBeDefined();
      }).pipe(Effect.provide(TestLayers));
    });

    it.effect("fails when username or password is missing", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createMockConfig("admin", "test-password")
      );
      const JwtServiceTest = Layer.succeed(JwtService, createMockJwtService());
      const TestLayers = Layer.mergeAll(ConfigServiceTest, JwtServiceTest);

      return Effect.gen(function* () {
        const result = yield* Effect.either(
          loginHandler({ payload: { username: "", password: "" } })
        );

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBe("Username and password are required");
        }
      }).pipe(Effect.provide(TestLayers));
    });

    it.effect("fails when auth is not configured", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createMockConfig("admin", "")
      );
      const JwtServiceTest = Layer.succeed(JwtService, createMockJwtService());
      const TestLayers = Layer.mergeAll(ConfigServiceTest, JwtServiceTest);

      return Effect.gen(function* () {
        const result = yield* Effect.either(
          loginHandler({ payload: { username: "admin", password: "wrong" } })
        );

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toContain("Authentication is not configured");
        }
      }).pipe(Effect.provide(TestLayers));
    });

    it.effect("fails with invalid credentials", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createMockConfig("admin", "test-password")
      );
      const JwtServiceTest = Layer.succeed(JwtService, createMockJwtService());
      const TestLayers = Layer.mergeAll(ConfigServiceTest, JwtServiceTest);

      return Effect.gen(function* () {
        const result = yield* Effect.either(
          loginHandler({ payload: { username: "admin", password: "wrong" } })
        );

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBe("Invalid username or password");
        }
      }).pipe(Effect.provide(TestLayers));
    });
  });

  describe("logout", () => {
    it.effect("returns success message", () => {
      return Effect.gen(function* () {
        const result = yield* logoutHandler();

        expect(result.success).toBe(true);
        expect(result.message).toBe("Logged out successfully");
      });
    });
  });

  describe("me", () => {
    it.effect("returns authenticated user when auth is configured", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createMockConfig("admin", "test-password")
      );
      const AuthenticatedUserTest = Layer.succeed(AuthenticatedUser, {
        username: "admin",
        iat: Date.now(),
        exp: Date.now() + 86400000,
      });
      const TestLayers = Layer.mergeAll(
        ConfigServiceTest,
        AuthenticatedUserTest
      );

      return Effect.gen(function* () {
        const result = yield* meHandler();

        expect(result.username).toBe("admin");
        expect(result.authenticated).toBe(true);
      }).pipe(Effect.provide(TestLayers));
    });

    it.effect(
      "returns unauthenticated user when auth is not configured",
      () => {
        const ConfigServiceTest = Layer.succeed(
          ConfigService,
          createMockConfig("admin", "")
        );
        const AuthenticatedUserTest = Layer.succeed(AuthenticatedUser, {
          username: "anonymous",
          iat: Date.now(),
          exp: Date.now() + 86400000,
        });
        const TestLayers = Layer.mergeAll(
          ConfigServiceTest,
          AuthenticatedUserTest
        );

        return Effect.gen(function* () {
          const result = yield* meHandler();

          expect(result.username).toBe("anonymous");
          expect(result.authenticated).toBe(false);
        }).pipe(Effect.provide(TestLayers));
      }
    );
  });

  describe("status", () => {
    it.effect("returns authRequired true when password is configured", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createMockConfig("admin", "test-password")
      );

      return Effect.gen(function* () {
        const result = yield* statusHandler();

        expect(result.authRequired).toBe(true);
      }).pipe(Effect.provide(ConfigServiceTest));
    });

    it.effect("returns authRequired false when no password configured", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createMockConfig("admin", "")
      );

      return Effect.gen(function* () {
        const result = yield* statusHandler();

        expect(result.authRequired).toBe(false);
      }).pipe(Effect.provide(ConfigServiceTest));
    });
  });
});
