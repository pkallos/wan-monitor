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

export function isDbUnavailableError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status !== 503) return false;
  const details = error.details as { error?: string } | undefined;
  return details?.error === "DB_UNAVAILABLE";
}
