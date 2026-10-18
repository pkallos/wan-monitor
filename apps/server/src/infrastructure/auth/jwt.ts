import { Context, Data, Effect, Layer, Redacted } from "effect";
import jwt from "jsonwebtoken";
import { ConfigService } from "@/infrastructure/config/config";

// ============================================================================
// Error Types
// ============================================================================

export class JwtInvalidError extends Data.TaggedError("JwtInvalidError")<{
  readonly message: string;
}> {}

export class JwtExpiredError extends Data.TaggedError("JwtExpiredError")<{
  readonly message: string;
}> {}

export class JwtMissingError extends Data.TaggedError("JwtMissingError")<{
  readonly message: string;
}> {}

export type JwtError = JwtInvalidError | JwtExpiredError | JwtMissingError;

// ============================================================================
// Types
// ============================================================================

export interface JwtPayload {
  readonly username: string;
  readonly iat: number;
  readonly exp: number;
}

const isJwtPayload = (value: unknown): value is JwtPayload =>
  typeof value === "object" &&
  value !== null &&
  "username" in value &&
  typeof value.username === "string" &&
  "iat" in value &&
  typeof value.iat === "number" &&
  "exp" in value &&
  typeof value.exp === "number";

export interface TokenResponse {
  readonly token: string;
  readonly expiresAt: string;
}

// ============================================================================
// Service Interface
// ============================================================================

export interface JwtServiceInterface {
  /**
   * Generate a JWT token for a user
   */
  readonly sign: (username: string) => Effect.Effect<TokenResponse, never>;

  /**
   * Verify and decode a JWT token
   */
  readonly verify: (token: string) => Effect.Effect<JwtPayload, JwtError>;

  /**
   * Decode a token without verification (for getting expiration)
   */
  readonly decode: (token: string) => Effect.Effect<JwtPayload | null, never>;
}

// ============================================================================
// Service Tag
// ============================================================================

export class JwtService extends Context.Service<
  JwtService,
  JwtServiceInterface
>()("JwtService") {}

// ============================================================================
// Service Implementation
// ============================================================================

export const JwtServiceLive = Layer.effect(
  JwtService,
  Effect.gen(function* () {
    const config = yield* ConfigService;

    const sign = (username: string): Effect.Effect<TokenResponse, never> =>
      Effect.suspend(() => {
        const token = jwt.sign(
          { username },
          Redacted.value(config.auth.jwtSecret),
          { expiresIn: config.auth.jwtExpiresInSeconds }
        );

        const decoded = jwt.decode(token);
        return isJwtPayload(decoded)
          ? Effect.succeed({
              token,
              expiresAt: new Date(decoded.exp * 1000).toISOString(),
            })
          : Effect.die(new Error("signed token is missing its exp claim"));
      });

    const verify = (token: string): Effect.Effect<JwtPayload, JwtError> =>
      Effect.try({
        try: () => {
          const decoded = jwt.verify(
            token,
            Redacted.value(config.auth.jwtSecret)
          );
          if (!isJwtPayload(decoded)) {
            throw new Error("Invalid token payload");
          }
          return decoded;
        },
        catch: (error) => {
          if (error instanceof Error) {
            if (error.name === "TokenExpiredError") {
              return new JwtExpiredError({ message: error.message });
            }
            if (error.name === "JsonWebTokenError") {
              return new JwtInvalidError({ message: error.message });
            }
          }
          return new JwtInvalidError({ message: "Invalid token" });
        },
      });

    const decode = (token: string): Effect.Effect<JwtPayload | null, never> =>
      Effect.sync(() => {
        try {
          const decoded = jwt.decode(token);
          return isJwtPayload(decoded) ? decoded : null;
        } catch {
          return null;
        }
      });

    return { sign, verify, decode };
  })
);
