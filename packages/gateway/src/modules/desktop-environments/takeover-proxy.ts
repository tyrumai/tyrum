import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { Logger } from "../observability/logger.js";
import {
  DESKTOP_TAKEOVER_ENTRY_FILENAME,
  ensureDesktopTakeoverEntrySearch,
  parseDesktopTakeoverProxyPath,
} from "./takeover-session.js";
import { DesktopTakeoverSessionDal } from "./takeover-session-dal.js";

const ALLOWED_TAKEOVER_ROOT_FILES = new Set([
  "favicon.ico",
  "manifest.json",
  "vnc.html",
  "vnc_lite.html",
  "websockify",
]);
const ALLOWED_TAKEOVER_ROOT_DIRECTORIES = new Set([
  "app",
  "core",
  "images",
  "include",
  "locale",
  "locales",
  "vendor",
]);
const PROXY_ALLOWED_HTTP_METHODS = new Set(["GET", "HEAD"]);
const STRIPPED_PROXY_REQUEST_HEADERS = new Set([
  "authorization",
  "connection",
  "cookie",
  "forwarded",
  "host",
  "keep-alive",
  "origin",
  "proxy-authorization",
  "proxy-connection",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);
const STRIPPED_PROXY_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "set-cookie",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function decodeTakeoverPathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch (error) {
    void error;
    return null;
  }
}

function isAllowedTakeoverUpstreamPath(upstreamPath: string): boolean {
  const segments = upstreamPath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return false;
  }

  const decodedSegments: string[] = [];
  for (const segment of segments) {
    const decoded = decodeTakeoverPathSegment(segment);
    if (
      !decoded ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes("\0")
    ) {
      return false;
    }
    decodedSegments.push(decoded);
  }

  const [firstSegment] = decodedSegments;
  if (!firstSegment) {
    return false;
  }
  if (decodedSegments.length === 1 && ALLOWED_TAKEOVER_ROOT_FILES.has(firstSegment)) {
    return true;
  }
  return ALLOWED_TAKEOVER_ROOT_DIRECTORIES.has(firstSegment);
}

function isTakeoverEntryPath(upstreamPath: string): boolean {
  const segments = upstreamPath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length !== 1) {
    return false;
  }
  const [segment] = segments;
  if (!segment) {
    return false;
  }
  return decodeTakeoverPathSegment(segment) === DESKTOP_TAKEOVER_ENTRY_FILENAME;
}

function buildUpstreamTakeoverUrl(input: {
  sessionUpstreamUrl: string;
  upstreamPath: string;
  search: string;
  websocket: boolean;
}): string | null {
  if (!isAllowedTakeoverUpstreamPath(input.upstreamPath)) {
    return null;
  }
  const upstreamUrl = new URL(input.sessionUpstreamUrl);
  if (input.websocket) {
    upstreamUrl.protocol = upstreamUrl.protocol === "https:" ? "wss:" : "ws:";
  }
  upstreamUrl.pathname = `/${input.upstreamPath.replace(/^\/+/u, "")}`;
  upstreamUrl.search = input.search;
  upstreamUrl.hash = "";
  return upstreamUrl.toString();
}

function copyProxyRequestHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const header of STRIPPED_PROXY_REQUEST_HEADERS) {
    headers.delete(header);
  }
  return headers;
}

function copyProxyResponseHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const header of STRIPPED_PROXY_RESPONSE_HEADERS) {
    headers.delete(header);
  }
  return headers;
}

function upgradeFailureResponse(status: number, message: string): Buffer {
  return Buffer.from(
    `HTTP/1.1 ${status} ${status === 404 ? "Not Found" : "Bad Gateway"}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${String(Buffer.byteLength(message))}\r\n\r\n` +
      message,
    "utf8",
  );
}

function closeSocketWithResponse(socket: Duplex, status: number, message: string): void {
  socket.write(upgradeFailureResponse(status, message));
  socket.destroy();
}

function toCloseReason(reason: Buffer): string {
  const text = reason.toString("utf8").trim();
  return text.length > 0 ? text : "desktop takeover session closed";
}

function isForwardableWebSocketCloseCode(code: number): boolean {
  return (
    code === 1000 ||
    (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) ||
    (code >= 3000 && code <= 4999)
  );
}

function forwardWebSocketClose(input: {
  peer: WebSocket;
  code: number;
  reason: Buffer;
  source: "client" | "upstream";
  target: "client" | "upstream";
  logger?: Logger;
  environmentId: string;
  sessionId: string;
  upstreamUrl?: string;
}): void {
  if (input.peer.readyState === WebSocket.OPEN) {
    if (isForwardableWebSocketCloseCode(input.code)) {
      input.peer.close(input.code, toCloseReason(input.reason));
      return;
    }
    input.logger?.warn("desktop_takeover.ws_invalid_close_code", {
      close_code: input.code,
      source: input.source,
      target: input.target,
      environment_id: input.environmentId,
      session_id: input.sessionId,
      ...(input.upstreamUrl ? { upstream_url: input.upstreamUrl } : {}),
    });
    input.peer.terminate();
    return;
  }
  if (input.peer.readyState === WebSocket.CONNECTING) {
    input.peer.terminate();
  }
}

export async function proxyDesktopTakeoverHttpRequest(input: {
  request: Request;
  sessionDal: DesktopTakeoverSessionDal;
  logger?: Logger;
}): Promise<Response> {
  const requestUrl = new URL(input.request.url);
  const parsed = parseDesktopTakeoverProxyPath(requestUrl.pathname);
  if (!parsed) {
    return new Response("desktop takeover path not found", { status: 404 });
  }
  if (!PROXY_ALLOWED_HTTP_METHODS.has(input.request.method)) {
    return new Response("desktop takeover method not allowed", {
      status: 405,
      headers: {
        allow: "GET, HEAD",
      },
    });
  }

  const session = await input.sessionDal.getActiveByToken(parsed.token);
  if (!session) {
    return new Response("desktop takeover session not found", { status: 404 });
  }
  if (isTakeoverEntryPath(parsed.upstreamPath)) {
    const canonicalSearch = ensureDesktopTakeoverEntrySearch(requestUrl.search);
    if (canonicalSearch !== requestUrl.search) {
      return new Response(null, {
        status: 307,
        headers: {
          location: `${requestUrl.pathname}${canonicalSearch}`,
        },
      });
    }
  }

  const upstreamUrl = buildUpstreamTakeoverUrl({
    sessionUpstreamUrl: session.upstreamUrl,
    upstreamPath: parsed.upstreamPath,
    search: requestUrl.search,
    websocket: false,
  });
  if (!upstreamUrl) {
    return new Response("desktop takeover path not found", { status: 404 });
  }

  try {
    const headers = copyProxyRequestHeaders(input.request.headers);
    const init: RequestInit = {
      method: input.request.method,
      headers,
      redirect: "manual",
    };

    const upstreamResponse = await fetch(upstreamUrl, init);
    if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
      input.logger?.warn("desktop_takeover.http_proxy_redirect_blocked", {
        environment_id: session.environmentId,
        session_id: session.sessionId,
        status: upstreamResponse.status,
        upstream_url: upstreamUrl,
      });
      return new Response("desktop takeover upstream unavailable", { status: 502 });
    }
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: copyProxyResponseHeaders(upstreamResponse.headers),
    });
  } catch (error) {
    input.logger?.error("desktop_takeover.http_proxy_failed", {
      error,
      environment_id: session.environmentId,
      session_id: session.sessionId,
      upstream_url: upstreamUrl,
    });
    return new Response("desktop takeover upstream unavailable", { status: 502 });
  }
}

export function createDesktopTakeoverWsProxy(input: {
  sessionDal: DesktopTakeoverSessionDal;
  logger?: Logger;
}): {
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
} {
  const wss = new WebSocketServer({ noServer: true });

  const bridgeClient = (params: {
    client: WebSocket;
    upstream: WebSocket;
    pendingMessages: Array<{ data: RawData; isBinary: boolean }>;
    environmentId: string;
    sessionId: string;
    upstreamUrl: string;
  }) => {
    params.upstream.on("open", () => {
      for (const message of params.pendingMessages) {
        params.upstream.send(message.data, { binary: message.isBinary });
      }
      params.pendingMessages.length = 0;
    });

    params.client.on("message", (data, isBinary) => {
      if (params.upstream.readyState === WebSocket.OPEN) {
        params.upstream.send(data, { binary: isBinary });
        return;
      }
      if (params.upstream.readyState === WebSocket.CONNECTING) {
        params.pendingMessages.push({ data, isBinary });
      }
    });

    params.upstream.on("message", (data, isBinary) => {
      if (params.client.readyState === WebSocket.OPEN) {
        params.client.send(data, { binary: isBinary });
      }
    });

    params.client.on("close", (code, reason) => {
      forwardWebSocketClose({
        peer: params.upstream,
        code,
        reason,
        source: "client",
        target: "upstream",
        logger: input.logger,
        environmentId: params.environmentId,
        sessionId: params.sessionId,
        upstreamUrl: params.upstreamUrl,
      });
    });

    params.upstream.on("close", (code, reason) => {
      forwardWebSocketClose({
        peer: params.client,
        code,
        reason,
        source: "upstream",
        target: "client",
        logger: input.logger,
        environmentId: params.environmentId,
        sessionId: params.sessionId,
        upstreamUrl: params.upstreamUrl,
      });
    });

    params.client.on("error", (error) => {
      input.logger?.error("desktop_takeover.ws_client_error", {
        error,
        environment_id: params.environmentId,
        session_id: params.sessionId,
      });
      if (params.upstream.readyState === WebSocket.OPEN) {
        params.upstream.close(1011, "desktop takeover client error");
      } else {
        params.upstream.terminate();
      }
    });

    params.upstream.on("error", (error) => {
      input.logger?.error("desktop_takeover.ws_upstream_error", {
        error,
        environment_id: params.environmentId,
        session_id: params.sessionId,
        upstream_url: params.upstreamUrl,
      });
      if (params.client.readyState === WebSocket.OPEN) {
        params.client.close(1011, "desktop takeover upstream unavailable");
      } else {
        params.client.terminate();
      }
    });
  };

  return {
    handleUpgrade: (req, socket, head) => {
      void (async () => {
        const requestUrl = new URL(req.url ?? "/", "http://localhost");
        const parsed = parseDesktopTakeoverProxyPath(requestUrl.pathname);
        if (!parsed) {
          closeSocketWithResponse(socket, 404, "desktop takeover path not found");
          return;
        }

        const session = await input.sessionDal.getActiveByToken(parsed.token);
        if (!session) {
          closeSocketWithResponse(socket, 404, "desktop takeover session not found");
          return;
        }

        const upstreamUrl = buildUpstreamTakeoverUrl({
          sessionUpstreamUrl: session.upstreamUrl,
          upstreamPath: parsed.upstreamPath,
          search: requestUrl.search,
          websocket: true,
        });
        if (!upstreamUrl) {
          closeSocketWithResponse(socket, 404, "desktop takeover path not found");
          return;
        }
        const requestedProtocols = req.headers["sec-websocket-protocol"];
        const protocols =
          typeof requestedProtocols === "string"
            ? requestedProtocols
                .split(",")
                .map((protocol) => protocol.trim())
                .filter(Boolean)
            : undefined;

        wss.handleUpgrade(req, socket, head, (client) => {
          const upstream = new WebSocket(upstreamUrl, protocols);
          bridgeClient({
            client,
            upstream,
            pendingMessages: [],
            environmentId: session.environmentId,
            sessionId: session.sessionId,
            upstreamUrl,
          });
        });
      })().catch((error) => {
        input.logger?.error("desktop_takeover.ws_upgrade_failed", { error });
        closeSocketWithResponse(socket, 502, "desktop takeover upstream unavailable");
      });
    },
  };
}
