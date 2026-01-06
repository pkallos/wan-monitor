import { HttpServerRequest } from "@effect/platform";
import {
  type AuthenticatedUserValue,
  Authorization,
  Unauthorized,
} from "@shared/api/middlewares/authorization";
import { Context, Effect, Layer } from "effect";
import { ConfigService } from "@/services/config";
import { type JwtError, type JwtPayload, JwtService } from "@/services/jwt";

// ============================================================================
// Auth Service (internal JWT verification logic)
// ============================================================================

export interface AuthServiceInterface {
  readonly verifyRequest: (
    authHeader: string | undefined
  ) => Effect.Effect<JwtPayload | null, AuthError>;
  readonly isAuthRequired: () => Effect.Effect<boolean, never>;
}

export class AuthService extends Context.Tag("AuthService")<
  AuthService,
  AuthServiceInterface
>() {}

export class UnauthorizedError {
  readonly _tag = "UnauthorizedError";
  constructor(readonly message: string) {}
}

export class MissingAuthHeaderError {
  readonly _tag = "MissingAuthHeaderError";
  constructor(readonly message: string) {}
}

export type AuthError = UnauthorizedError | MissingAuthHeaderError | JwtError;

export const AuthServiceLive = Layer.effect(
  AuthService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const jwtService = yield* JwtService;

    const isAuthRequired = (): Effect.Effect<boolean, never> =>
      Effect.succeed(Boolean(config.auth.password));

    const verifyRequest = (
      authHeader: string | undefined
    ): Effect.Effect<JwtPayload | null, AuthError> =>
      Effect.gen(function* () {
        if (!config.auth.password) {
          return null;
        }

        if (!authHeader) {
          return yield* Effect.fail(
            new MissingAuthHeaderError("Authorization header required")
          );
        }

        const token = authHeader.startsWith("Bearer ")
          ? authHeader.slice(7)
          : authHeader;

        if (!token) {
          return yield* Effect.fail(
            new MissingAuthHeaderError("Bearer token required")
          );
        }

        const payload = yield* jwtService
          .verify(token)
          .pipe(
            Effect.mapError(
              (error) =>
                new UnauthorizedError(`Invalid token: ${error.message}`)
            )
          );

        return payload;
      });

    return { verifyRequest, isAuthRequired };
  })
);

// ============================================================================
// HTTP Middleware (uses AuthService to enforce auth on protected routes)
// ============================================================================
export const AuthorizationLive = Layer.effect(
  Authorization,
  Effect.gen(function* () {
    const authService = yield* AuthService;

    // Middleware implementation as an Effect that can access HttpServerRequest
    return Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const authHeader = request.headers.authorization;

      const payload = yield* authService
        .verifyRequest(authHeader)
        .pipe(
          Effect.mapError(
            (error) =>
              new Unauthorized({ message: error.message ?? "Unauthorized" })
          )
        );

      const anonymous: AuthenticatedUserValue = {
        username: "anonymous",
        iat: Date.now() / 1000,
        exp: Date.now() / 1000 + 86400,
      };

      return payload ?? anonymous;
    });
  })
);
