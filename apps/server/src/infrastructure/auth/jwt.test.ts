import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Result } from "effect";
import jsonwebtoken from "jsonwebtoken";
import { vi } from "vitest";
import {
  JwtExpiredError,
  JwtInvalidError,
  JwtService,
  JwtServiceLive,
} from "@/infrastructure/auth/jwt";
import { type AppConfig, ConfigService } from "@/infrastructure/config/config";
import { makeTestAppConfig } from "@/test/config";

const createTestConfigService = (jwtSecret: string): AppConfig =>
  makeTestAppConfig({ auth: { password: "test-password", jwtSecret } });

describe("JWT Service", () => {
  describe("sign", () => {
    it.effect("generates a valid JWT token", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-secret")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);

      return Effect.gen(function* () {
        const jwtService = yield* JwtService;
        const result = yield* jwtService.sign("testuser");

        expect(result.token).toBeDefined();
        expect(result.token).toContain(".");
        expect(result.expiresAt).toBeDefined();
        expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(
          Date.now()
        );
        return result;
      }).pipe(Effect.provide(JwtServiceTest));
    });

    it.effect(
      "signs with the configured expiry and derives expiresAt from it",
      () => {
        const ConfigServiceTest = Layer.succeed(
          ConfigService,
          makeTestAppConfig({
            auth: { password: "test-password", jwtExpiresInSeconds: 3600 },
          })
        );

        const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);

        return Effect.gen(function* () {
          const jwtService = yield* JwtService;
          const { token, expiresAt } = yield* jwtService.sign("testuser");
          const payload = yield* jwtService.decode(token);

          expect(payload).not.toBeNull();
          if (payload !== null) {
            expect(payload.exp - payload.iat).toBe(3600);
            expect(expiresAt).toBe(new Date(payload.exp * 1000).toISOString());
          }
        }).pipe(Effect.provide(JwtServiceTest));
      }
    );

    it.effect("dies when the token it just signed has no exp claim", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-secret")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);

      return Effect.gen(function* () {
        const jwtService = yield* JwtService;
        const decodeSpy = vi.spyOn(jsonwebtoken, "decode").mockReturnValueOnce({
          username: "testuser",
        });
        const exit = yield* Effect.exit(jwtService.sign("testuser")).pipe(
          Effect.ensuring(Effect.sync(() => decodeSpy.mockRestore()))
        );

        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      }).pipe(Effect.provide(JwtServiceTest));
    });

    it.effect("includes username in token payload", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-secret")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);

      return Effect.gen(function* () {
        const jwtService = yield* JwtService;
        const { token } = yield* jwtService.sign("testuser");
        const decoded = yield* jwtService.decode(token);

        expect(decoded).toBeDefined();
        expect(decoded?.username).toBe("testuser");
        expect(decoded?.iat).toBeDefined();
        expect(decoded?.exp).toBeDefined();
        return decoded;
      }).pipe(Effect.provide(JwtServiceTest));
    });
  });

  describe("verify", () => {
    it.effect("successfully verifies a valid token", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-secret")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);

      return Effect.gen(function* () {
        const jwtService = yield* JwtService;
        const { token } = yield* jwtService.sign("testuser");
        const payload = yield* jwtService.verify(token);

        expect(payload.username).toBe("testuser");
        expect(payload.iat).toBeDefined();
        expect(payload.exp).toBeDefined();
        return payload;
      }).pipe(Effect.provide(JwtServiceTest));
    });

    it.effect("fails to verify invalid token", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-secret")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);

      return Effect.gen(function* () {
        const jwtService = yield* JwtService;
        const result = yield* Effect.result(
          jwtService.verify("invalid.token.here")
        );

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure).toBeInstanceOf(JwtInvalidError);
        }
        return result;
      }).pipe(Effect.provide(JwtServiceTest));
    });

    it.effect("fails to verify token signed with different secret", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-secret")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);

      return Effect.gen(function* () {
        const jwtService = yield* JwtService;

        // Token signed with a different secret (manually constructed)
        const fakeToken =
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6InRlc3R1c2VyIiwiaWF0IjoxNjE2MjM5MDIyfQ.L8i6g3PfcHlioHCCPURC9pmXT7gdJpx3kOoyAfNUwCc";

        const result = yield* Effect.result(jwtService.verify(fakeToken));

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure).toBeInstanceOf(JwtInvalidError);
        }
        return result;
      }).pipe(Effect.provide(JwtServiceTest));
    });

    it.effect(
      "fails with JwtInvalidError when a validly signed token's payload is missing required fields",
      () => {
        const ConfigServiceTest = Layer.succeed(
          ConfigService,
          createTestConfigService("test-secret")
        );

        const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);

        // Correctly signed with the configured secret, but not shaped like a
        // JwtPayload (no `username`), so `isJwtPayload` rejects it after a
        // successful cryptographic verification.
        const malformedToken = jsonwebtoken.sign({ foo: "bar" }, "test-secret");

        return Effect.gen(function* () {
          const jwtService = yield* JwtService;
          const result = yield* Effect.result(
            jwtService.verify(malformedToken)
          );

          expect(Result.isFailure(result)).toBe(true);
          if (Result.isFailure(result)) {
            expect(result.failure).toBeInstanceOf(JwtInvalidError);
            expect(result.failure.message).toBe("Invalid token");
          }
          return result;
        }).pipe(Effect.provide(JwtServiceTest));
      }
    );

    it.effect("fails with JwtExpiredError for an expired token", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-secret")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);
      const issuedAt = Math.floor(Date.now() / 1000) - 100;
      const expiredToken = jsonwebtoken.sign(
        { username: "testuser", iat: issuedAt, exp: issuedAt + 1 },
        "test-secret"
      );

      return Effect.gen(function* () {
        const jwtService = yield* JwtService;
        const result = yield* Effect.result(jwtService.verify(expiredToken));

        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure).toBeInstanceOf(JwtExpiredError);
        }
        return result;
      }).pipe(Effect.provide(JwtServiceTest));
    });
  });

  describe("decode", () => {
    it.effect("decodes token without verification", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-secret")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);

      return Effect.gen(function* () {
        const jwtService = yield* JwtService;
        const { token } = yield* jwtService.sign("testuser");
        const decoded = yield* jwtService.decode(token);

        expect(decoded).toBeDefined();
        expect(decoded?.username).toBe("testuser");
        return decoded;
      }).pipe(Effect.provide(JwtServiceTest));
    });

    it.effect("returns null for invalid token", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-secret")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);

      return Effect.gen(function* () {
        const jwtService = yield* JwtService;
        const decoded = yield* jwtService.decode("not.a.valid.token");

        expect(decoded).toBeNull();
        return decoded;
      }).pipe(Effect.provide(JwtServiceTest));
    });

    it.effect("returns null when jwt.decode throws", () => {
      const ConfigServiceTest = Layer.succeed(
        ConfigService,
        createTestConfigService("test-secret")
      );

      const JwtServiceTest = Layer.provide(JwtServiceLive, ConfigServiceTest);
      const decodeSpy = vi
        .spyOn(jsonwebtoken, "decode")
        .mockImplementationOnce(() => {
          throw new Error("boom");
        });

      return Effect.gen(function* () {
        const jwtService = yield* JwtService;
        const decoded = yield* jwtService.decode("whatever");
        decodeSpy.mockRestore();

        expect(decoded).toBeNull();
        return decoded;
      }).pipe(Effect.provide(JwtServiceTest));
    });
  });
});
