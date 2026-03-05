export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message) return error.message;
    if (error.name) return error.name;
    return "Error";
  }

  if (typeof error === "string") return error;

  try {
    const value = JSON.stringify(error);
    return typeof value === "string" ? value : String(error);
  } catch {
    return String(error);
  }
}
