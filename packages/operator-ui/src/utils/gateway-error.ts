export function truncateText(text: string, limit = 300): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

export async function readGatewayError(res: Response): Promise<string> {
  const contentType = res.headers.get("content-type")?.trim().toLowerCase() ?? "";
  const maybeJson =
    contentType.includes("application/json") ||
    contentType.includes("+json") ||
    contentType.includes("/json");

  let bodyText: string;
  try {
    bodyText = await res.text();
  } catch {
    return `HTTP ${String(res.status)}`;
  }

  const trimmedText = bodyText.trim();
  if (!trimmedText) {
    return `HTTP ${String(res.status)}`;
  }

  if (maybeJson) {
    try {
      const body = JSON.parse(trimmedText) as unknown;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const message = (body as Record<string, unknown>)["message"];
        if (typeof message === "string" && message.trim()) {
          return message.trim();
        }

        const error = (body as Record<string, unknown>)["error"];
        if (typeof error === "string" && error.trim()) {
          return error.trim();
        }
      }
    } catch {
      // ignore
    }
  }

  return truncateText(trimmedText);
}
