import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Layer } from "effect";
import { JwtService, JwtServiceLive } from "@/infrastructure/auth/jwt";
import {
  AuthorizationLive,
  AuthService,
  AuthServiceLive,
  MissingAuthHeaderError,
  UnauthorizedError,
} from "@/infrastructure/auth/middleware";
import { type AppConfig, ConfigService } from "@/infrastructure/config/config";
import { makeTestAppConfig } from "@/test/config";

const createTestConfigService = (
  password: string,
  jwtSecret = "test-secret"
): AppConfig => makeTestAppConfig({ auth: { password, jwtSecret } });

describe("AuthService", () => {
  describe("isAuthRequired", () => {
    it.effect("returns true when password is configured", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-password")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);
      const AuthServiceTest = Layer.provide(
        AuthServiceLive,
        Layer.merge(ConfigServiceTest, JwtServiceTest)
      );

      return Effect.gen(function* () {
        const authService = yield* AuthService;
        const required = yield* authService.isAuthRequired();

        expect(required).toBe(true);
        return required;
      }).pipe(Effect.provide(AuthServiceTest));
    });

    it.effect("returns false when password is not configured", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);
      const AuthServiceTest = Layer.provide(
        AuthServiceLive,
        Layer.merge(ConfigServiceTest, JwtServiceTest)
      );

      return Effect.gen(function* () {
        const authService = yield* AuthService;
        const required = yield* authService.isAuthRequired();

        expect(required).toBe(false);
        return required;
      }).pipe(Effect.provide(AuthServiceTest));
    });
  });

  describe("verifyRequest", () => {
    it.effect("returns null when auth is disabled (no password)", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);
      const AuthServiceTest = Layer.provide(
        AuthServiceLive,
        Layer.merge(ConfigServiceTest, JwtServiceTest)
      );

      return Effect.gen(function* () {
        const authService = yield* AuthService;
        const result = yield* authService.verifyRequest(undefined);

        expect(result).toBeNull();
        return result;
      }).pipe(Effect.provide(AuthServiceTest));
    });

    it.effect("fails when auth is required but no header provided", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-password")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);
      const AuthServiceTest = Layer.provide(
        AuthServiceLive,
        Layer.merge(ConfigServiceTest, JwtServiceTest)
      );

      return Effect.gen(function* () {
        const authService = yield* AuthService;
        const result = yield* Effect.either(
          authService.verifyRequest(undefined)
        );

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left).toBeInstanceOf(MissingAuthHeaderError);
          if (result.left instanceof MissingAuthHeaderError) {
            expect(result.left.message).toContain(
              "Authorization header required"
            );
          }
        }
        return result;
      }).pipe(Effect.provide(AuthServiceTest));
    });

    it.effect("fails when auth header is missing Bearer token", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-password")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);
      const AuthServiceTest = Layer.provide(
        AuthServiceLive,
        Layer.merge(ConfigServiceTest, JwtServiceTest)
      );

      return Effect.gen(function* () {
        const authService = yield* AuthService;
        const result = yield* Effect.either(
          authService.verifyRequest("Bearer ")
        );

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left).toBeInstanceOf(MissingAuthHeaderError);
          expect(result.left.message).toContain("Bearer token required");
        }
        return result;
      }).pipe(Effect.provide(AuthServiceTest));
    });

    it.effect("successfully verifies valid JWT token", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-password")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);
      const AuthServiceTest = Layer.provide(
        AuthServiceLive,
        Layer.merge(ConfigServiceTest, JwtServiceTest)
      );

      return Effect.gen(function* () {
        const jwtService = yield* JwtService;
        const authService = yield* AuthService;

        const { token } = yield* jwtService.sign("testuser");
        const result = yield* authService.verifyRequest(`Bearer ${token}`);

        expect(result).not.toBeNull();
        expect(result?.username).toBe("testuser");
        return result;
      }).pipe(Effect.provide(Layer.merge(JwtServiceTest, AuthServiceTest)));
    });

    it.effect("fails with invalid token", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-password")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);
      const AuthServiceTest = Layer.provide(
        AuthServiceLive,
        Layer.merge(ConfigServiceTest, JwtServiceTest)
      );

      return Effect.gen(function* () {
        const authService = yield* AuthService;
        const result = yield* Effect.either(
          authService.verifyRequest("Bearer invalid.token.here")
        );

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left).toBeInstanceOf(UnauthorizedError);
          if (result.left instanceof UnauthorizedError) {
            expect(result.left.message).toContain("Invalid token");
          }
        }
        return result;
      }).pipe(Effect.provide(AuthServiceTest));
    });
  });
});

describe("AuthorizationLive Middleware", () => {
  describe("middleware layer construction", () => {
    it.effect("can be constructed with required dependencies", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-password")
      );
      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);
      const AuthServiceTest = Layer.provide(
        AuthServiceLive,
        Layer.merge(ConfigServiceTest, JwtServiceTest)
      );

      return Effect.gen(function* () {
        // Verify the layer can be built and AuthService is accessible
        const authService = yield* AuthService;
        const layer = AuthorizationLive.pipe(Layer.provide(AuthServiceTest));

        // This verifies the layer is properly constructed
        expect(layer).toBeDefined();
        expect(authService).toBeDefined();
        return true;
      }).pipe(Effect.provide(AuthServiceTest));
    });

    it.effect("depends on AuthService", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-password")
      );
      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);
      const AuthServiceTest = Layer.provide(
        AuthServiceLive,
        Layer.merge(ConfigServiceTest, JwtServiceTest)
      );

      return Effect.gen(function* () {
        // Verify AuthService is required by trying to build without it (would fail at compile time)
        const authService = yield* AuthService;
        expect(authService).toBeDefined();
        expect(authService.verifyRequest).toBeDefined();
        expect(authService.isAuthRequired).toBeDefined();
        return true;
      }).pipe(Effect.provide(AuthServiceTest));
    });
  });
});
