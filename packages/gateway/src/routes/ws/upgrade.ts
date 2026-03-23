import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocketServer } from "ws";
import {
  resolveClientIpFromRequest,
  type TrustedProxyAllowlist,
} from "../../app/modules/auth/client-ip.js";
import type { SlidingWindowRateLimiter } from "../../app/modules/auth/rate-limiter.js";
import { requestOffersWsBaseSubprotocol, WS_BASE_PROTOCOL } from "./auth.js";

export interface CreateHandleUpgradeOptions {
  wss: WebSocketServer;
  upgradeRateLimiter?: SlidingWindowRateLimiter;
  trustedProxies?: TrustedProxyAllowlist;
}

export function createHandleUpgrade(
  opts: CreateHandleUpgradeOptions,
): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  return (req, socket, head) => {
    if (rejectRateLimitedUpgrade(req, socket, opts.upgradeRateLimiter, opts.trustedProxies)) {
      return;
    }
    if (rejectMissingBaseProtocolUpgrade(req, socket)) {
      return;
    }

    opts.wss.handleUpgrade(req, socket, head, (ws) => {
      opts.wss.emit("connection", ws, req);
    });
  };
}

function rejectRateLimitedUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  upgradeRateLimiter: SlidingWindowRateLimiter | undefined,
  trustedProxies: TrustedProxyAllowlist | undefined,
): boolean {
  if (!upgradeRateLimiter) return false;

  const { resolvedClientIp: clientIp } = resolveClientIpFromRequest(req, trustedProxies);

  if (!clientIp) return false;

  const result = upgradeRateLimiter.check(`ws:${clientIp}`);
  if (result.allowed) return false;

  const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  const response = [
    "HTTP/1.1 429 Too Many Requests",
    `Retry-After: ${String(retryAfterSeconds)}`,
    "Connection: close",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n");

  try {
    socket.write(response);
  } catch (err) {
    void err;
  }

  try {
    socket.destroy();
  } catch (err) {
    void err;
  }

  return true;
}

function rejectMissingBaseProtocolUpgrade(req: IncomingMessage, socket: Duplex): boolean {
  if (requestOffersWsBaseSubprotocol(req)) return false;

  const body = `Missing required WebSocket subprotocol: ${WS_BASE_PROTOCOL}\n`;
  const response = [
    "HTTP/1.1 400 Bad Request",
    "Connection: close",
    "Content-Type: text/plain; charset=utf-8",
    `Content-Length: ${String(Buffer.byteLength(body))}`,
    "",
    body,
  ].join("\r\n");

  try {
    socket.end(response);
  } catch (err) {
    void err;
    try {
      socket.destroy();
    } catch (destroyErr) {
      void destroyErr;
    }
  }

  return true;
}
