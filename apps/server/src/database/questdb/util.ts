export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const isLikelyConnectionError = (message: string): boolean => {
  const m = message.toLowerCase();
  return (
    m.includes("econnrefused") ||
    m.includes("econnreset") ||
    m.includes("enotfound") ||
    m.includes("timeout") ||
    m.includes("connect") ||
    m.includes("connection") ||
    m.includes("socket") ||
    m.includes("terminated")
  );
};
