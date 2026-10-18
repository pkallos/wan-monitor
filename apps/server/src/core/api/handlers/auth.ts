import { createHash, timingSafeEqual } from "node:crypto";
import { WanMonitorApi } from "@shared/api";
import {
  AuthNotConfigured,
  InvalidCredentials,
  MissingCredentials,
} from "@shared/api/errors";
import { AuthenticatedUser } from "@shared/api/middlewares/authorization";
import { Effect, Option, Redacted } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { JwtService } from "@/infrastructure/auth/jwt";
import { ConfigService } from "@/infrastructure/config/config";

// Hashing first gives timingSafeEqual equal-length inputs whatever the caller sent.
const secureEquals = (a: string, b: string): boolean =>
  timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest()
  );

export const loginHandler = ({
  payload,
}: {
  payload: { username: string; password: string };
}) =>
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const jwtService = yield* JwtService;

    if (!payload.username || !payload.password) {
      return yield* Effect.fail(
        new MissingCredentials({
          message: "Username and password are required",
        })
      );
    }

    const configuredPassword = config.auth.password;
    if (Option.isNone(configuredPassword)) {
      return yield* Effect.fail(
        new AuthNotConfigured({
          message:
            "Authentication is not configured. Set WAN_MONITOR_PASSWORD.",
        })
      );
    }

    const usernameMatches = secureEquals(
      payload.username,
      config.auth.username
    );
    const passwordMatches = secureEquals(
      payload.password,
      Redacted.value(configuredPassword.value)
    );
    if (!(usernameMatches && passwordMatches)) {
      return yield* Effect.fail(
        new InvalidCredentials({ message: "Invalid username or password" })
      );
    }

    const { token, expiresAt } = yield* jwtService.sign(payload.username);

    return {
      token,
      expiresAt,
      username: payload.username,
    };
  });

export const logoutHandler = () =>
  Effect.succeed({
    success: true,
    message: "Logged out successfully",
  });

export const meHandler = () =>
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const user = yield* AuthenticatedUser;

    if (Option.isNone(config.auth.password)) {
      return {
        username: user.username,
        authenticated: false,
      };
    }

    return {
      username: user.username,
      authenticated: true,
    };
  });

export const statusHandler = () =>
  Effect.gen(function* () {
    const config = yield* ConfigService;
    return {
      authRequired: Option.isSome(config.auth.password),
    };
  });

export const AuthGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "auth",
  (handlers) =>
    handlers
      .handle("login", loginHandler)
      .handle("logout", logoutHandler)
      .handle("me", meHandler)
      .handle("status", statusHandler)
);
