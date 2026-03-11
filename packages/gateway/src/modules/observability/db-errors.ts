export function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const code = (err as { code?: unknown }).code;
  if (code === "42P01") return true;

  const message = (err as { message?: unknown }).message;
  if (typeof message !== "string") return false;
  const lowered = message.toLowerCase();
  return (
    lowered.includes("no such table") ||
    (lowered.includes("relation") && lowered.includes("does not exist"))
  );
}
