function normalizePort(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 8080;
}

export function toHttpAppUrlFromWsUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    } else if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.pathname = "/app";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function toGatewayAppUrl(config: unknown): string | null {
  const cfg =
    config && typeof config === "object" ? (config as Record<string, unknown>) : {};
  const mode = cfg["mode"] === "remote" ? "remote" : "embedded";

  if (mode === "embedded") {
    const embedded =
      cfg["embedded"] && typeof cfg["embedded"] === "object"
        ? (cfg["embedded"] as Record<string, unknown>)
        : {};
    const port = normalizePort(embedded["port"]);
    return `http://127.0.0.1:${port}/app`;
  }

  const remote =
    cfg["remote"] && typeof cfg["remote"] === "object"
      ? (cfg["remote"] as Record<string, unknown>)
      : {};
  const wsUrl =
    typeof remote["wsUrl"] === "string" ? remote["wsUrl"] : "ws://127.0.0.1:8080/ws";
  return toHttpAppUrlFromWsUrl(wsUrl);
}
