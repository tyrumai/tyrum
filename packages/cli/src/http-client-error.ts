export function isTyrumHttpClientError(error: unknown): error is Error & { status?: number } {
  return error instanceof Error && error.name === "TyrumHttpClientError";
}
