import { DB_UNAVAILABLE } from "@shared/api/errors";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The server returns a structured `{ error: "DB_UNAVAILABLE", ... }` body with
 * HTTP 503 when QuestDB is unreachable. The Effect HttpApiClient decodes that
 * declared error into this plain payload shape.
 */
function isDbUnavailablePayload(
  value: unknown
): value is { error: typeof DB_UNAVAILABLE; message?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { error?: unknown }).error === DB_UNAVAILABLE
  );
}

export function isDbUnavailableError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 503 && isDbUnavailablePayload(error.details);
  }
  return isDbUnavailablePayload(error);
}

// ---------------------------------------------------------------------------
// Typed error discrimination — Schema.TaggedError subclasses are decoded by
// the HttpApiClient into plain objects carrying an _tag field. These helpers
// normalize them into ApiError so the rest of the app keys off a single type.
// ---------------------------------------------------------------------------

/** Stable _tag values the server emits for typed auth/health errors. */
export const MISSING_CREDENTIALS = "MissingCredentials" as const;
export const INVALID_CREDENTIALS = "InvalidCredentials" as const;
export const AUTH_NOT_CONFIGURED = "AuthNotConfigured" as const;
export const HEALTH_UNHEALTHY = "HealthUnhealthy" as const;

interface DecodedTaggedError {
  readonly _tag: string;
  readonly message: string;
}

function isDecodedTaggedError(value: unknown): value is DecodedTaggedError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { _tag?: unknown })._tag === "string"
  );
}

/** Status code each typed error tag maps to. */
const TAG_TO_STATUS: Record<string, number> = {
  [MISSING_CREDENTIALS]: 400,
  [INVALID_CREDENTIALS]: 401,
  [AUTH_NOT_CONFIGURED]: 503,
  [HEALTH_UNHEALTHY]: 503,
};

/**
 * Normalizes the DB-unavailable failure decoded by the HttpApiClient into an
 * `ApiError`, so the rest of the app keys off a single error type. Any other
 * failure passes through unchanged.
 */
export function toApiError(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  if (isDbUnavailablePayload(error)) {
    return new ApiError(
      error.message ?? "Database temporarily unavailable",
      503,
      error
    );
  }
  if (isDecodedTaggedError(error)) {
    const status = TAG_TO_STATUS[error._tag];
    if (status !== undefined) {
      return new ApiError(error.message, status, error);
    }
  }
  return error;
}
