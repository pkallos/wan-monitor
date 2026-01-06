import { HttpApiBuilder } from "@effect/platform";
import { WanMonitorApi } from "@shared/api";
import { AuthenticatedUser } from "@shared/api/middlewares/authorization";
import { Effect } from "effect";
import { JwtService } from "@/infrastructure/auth/jwt";
import { ConfigService } from "@/infrastructure/config/config";

export const loginHandler = ({
  payload,
}: {
  payload: { username: string; password: string };
}) =>
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const jwtService = yield* JwtService;

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

    if (!config.auth.password) {
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
      authRequired: Boolean(config.auth.password),
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
