export function isUniqueViolation(err: unknown): boolean {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (code === "23505") return true; // Postgres unique_violation
    if (typeof code === "string" && code.toUpperCase().startsWith("SQLITE_CONSTRAINT")) {
      return true;
    }
  }
  return false;
}
