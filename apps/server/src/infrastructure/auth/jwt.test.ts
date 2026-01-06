import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  JwtInvalidError,
  JwtService,
  JwtServiceLive,
} from "@/infrastructure/auth/jwt";
import { type AppConfig, ConfigService } from "@/infrastructure/config/config";

const createTestConfigService = (jwtSecret: string): AppConfig => ({
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
    username: "admin",
    password: "test-password",
    jwtSecret,
    jwtExpiresIn: "24h",
  },
});

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
        const result = yield* Effect.either(
          jwtService.verify("invalid.token.here")
        );

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(JwtInvalidError);
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

        const result = yield* Effect.either(jwtService.verify(fakeToken));

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(JwtInvalidError);
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
  });
});
