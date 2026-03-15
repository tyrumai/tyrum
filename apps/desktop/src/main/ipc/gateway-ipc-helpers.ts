export type GatewayLogEntry = {
  level?: string;
  message?: string;
  timestamp?: string;
};

export function mirrorGatewayLogEntryToConsole(entry: GatewayLogEntry): void {
  if (process.env["TYRUM_DEBUG"]?.trim() !== "1") {
    return;
  }

  const message = typeof entry.message === "string" ? entry.message.trimEnd() : "";
  if (message.length === 0) {
    return;
  }

  const prefix = `[embedded-gateway${entry.timestamp ? ` ${entry.timestamp}` : ""}]`;
  const line = `${prefix} ${message}`;

  switch (entry.level) {
    case "error":
      console.error(line);
      return;
    case "warn":
      console.warn(line);
      return;
    default:
      console.log(line);
  }
}

export function parseGatewayHttpFetchInput(rawInput: unknown): {
  url: string;
  rawInit: Record<string, unknown> | undefined;
} {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    throw new Error("gateway:http-fetch requires a plain object");
  }

  const input = rawInput as {
    url?: unknown;
    init?: unknown;
  };

  if (typeof input.url !== "string") {
    throw new Error("gateway:http-fetch requires url:string");
  }

  const rawInit =
    input.init && typeof input.init === "object" && !Array.isArray(input.init)
      ? (input.init as Record<string, unknown>)
      : undefined;

  return { url: input.url, rawInit };
}

export function resolveGatewayHttpFetchUrl(rawUrl: string, allowedOrigin: string): URL {
  let requestUrl: URL;
  try {
    requestUrl = new URL(rawUrl);
  } catch {
    throw new Error("gateway:http-fetch requires an absolute URL");
  }

  if (requestUrl.origin !== allowedOrigin) {
    throw new Error("Only the configured gateway origin is allowed");
  }
  if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }

  return requestUrl;
}

export function buildGatewayHttpFetchInit(
  rawInit: Record<string, unknown> | undefined,
): RequestInit {
  const method = typeof rawInit?.["method"] === "string" ? rawInit["method"] : undefined;

  const rawHeaders =
    rawInit?.["headers"] &&
    typeof rawInit["headers"] === "object" &&
    !Array.isArray(rawInit["headers"])
      ? (rawInit["headers"] as Record<string, unknown>)
      : undefined;

  const body = typeof rawInit?.["body"] === "string" ? rawInit["body"] : undefined;

  const requestHeaders: Record<string, string> | undefined = rawHeaders
    ? Object.fromEntries(
        Object.entries(rawHeaders).flatMap(([key, value]) => {
          if (typeof value !== "string") return [];
          return [[key, value]];
        }),
      )
    : undefined;

  if (requestHeaders) {
    for (const headerName of Object.keys(requestHeaders)) {
      if (headerName.trim().toLowerCase() === "cookie") {
        throw new Error("Cookie header is not allowed");
      }
    }
  }

  return {
    method,
    headers: requestHeaders,
    body,
    redirect: "manual",
  };
}

export function collectResponseHeaders(response: Response): Record<string, string> {
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value;
  });
  return responseHeaders;
}
