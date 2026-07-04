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
  return error;
}
