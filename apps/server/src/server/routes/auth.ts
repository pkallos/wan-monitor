import { HttpApiBuilder } from "@effect/platform";
import { WanMonitorApi } from "@shared/api/main";
import { AuthenticatedUser } from "@shared/api/middlewares/authorization";
import { Effect } from "effect";
import { ConfigService } from "@/services/config";
import { JwtService } from "@/services/jwt";

export const AuthGroupLive = HttpApiBuilder.group(
  WanMonitorApi,
  "auth",
  (handlers) =>
    handlers
      .handle("login", ({ payload }) =>
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
        })
      )
      .handle("logout", () =>
        Effect.succeed({
          success: true,
          message: "Logged out successfully",
        })
      )
      .handle("me", () =>
        Effect.gen(function* () {
          const config = yield* ConfigService;

          const user = yield* AuthenticatedUser;

          // If auth is not configured, return anonymous user
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
        })
      )
      .handle("status", () =>
        Effect.gen(function* () {
          const config = yield* ConfigService;
          return {
            authRequired: Boolean(config.auth.password),
          };
        })
      )
);
