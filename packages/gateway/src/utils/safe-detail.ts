export function safeDetail(err: unknown): string | undefined {
  if (err instanceof Error) {
    const msg = err.message.trim();
    if (msg.length > 0) return msg.slice(0, 512);
  }
  if (typeof err === "string") {
    const msg = err.trim();
    if (msg.length > 0) return msg.slice(0, 512);
  }
  return undefined;
}
