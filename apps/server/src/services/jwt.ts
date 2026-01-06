import { Context, Effect, Layer } from "effect";
import jwt from "jsonwebtoken";
import { ConfigService } from "@/services/config";

// ============================================================================
// Error Types
// ============================================================================

export class JwtInvalidError {
  readonly _tag = "JwtInvalidError";
  constructor(readonly message: string) {}
}

export class JwtExpiredError {
  readonly _tag = "JwtExpiredError";
  constructor(readonly message: string) {}
}

export class JwtMissingError {
  readonly _tag = "JwtMissingError";
  constructor(readonly message: string) {}
}

export type JwtError = JwtInvalidError | JwtExpiredError | JwtMissingError;

// ============================================================================
// Types
// ============================================================================

export interface JwtPayload {
  readonly username: string;
  readonly iat: number;
  readonly exp: number;
}

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

export class JwtService extends Context.Tag("JwtService")<
  JwtService,
  JwtServiceInterface
>() {}

// ============================================================================
// Service Implementation
// ============================================================================

export const JwtServiceLive = Layer.effect(
  JwtService,
  Effect.gen(function* () {
    const config = yield* ConfigService;

    const sign = (username: string): Effect.Effect<TokenResponse, never> =>
      Effect.sync(() => {
        const token = jwt.sign({ username }, config.auth.jwtSecret, {
          expiresIn: config.auth.jwtExpiresIn as jwt.SignOptions["expiresIn"],
        });

        const decoded = jwt.decode(token) as JwtPayload;
        const expiresAt = decoded?.exp
          ? new Date(decoded.exp * 1000).toISOString()
          : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        return { token, expiresAt };
      });

    const verify = (token: string): Effect.Effect<JwtPayload, JwtError> =>
      Effect.try({
        try: () => {
          const decoded = jwt.verify(
            token,
            config.auth.jwtSecret
          ) as JwtPayload;
          return decoded;
        },
        catch: (error) => {
          if (error instanceof Error) {
            if (error.name === "TokenExpiredError") {
              return new JwtExpiredError(error.message);
            }
            if (error.name === "JsonWebTokenError") {
              return new JwtInvalidError(error.message);
            }
          }
          return new JwtInvalidError("Invalid token");
        },
      });

    const decode = (token: string): Effect.Effect<JwtPayload | null, never> =>
      Effect.sync(() => {
        try {
          return jwt.decode(token) as JwtPayload | null;
        } catch {
          return null;
        }
      });

    return { sign, verify, decode };
  })
);
