import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocketServer } from "ws";
import { resolveClientIp, type TrustedProxyAllowlist } from "../../modules/auth/client-ip.js";
import type { SlidingWindowRateLimiter } from "../../modules/auth/rate-limiter.js";
import { toSingleHeaderValue } from "./auth.js";

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

  const clientIp = resolveClientIp({
    remoteAddress: req.socket.remoteAddress,
    forwardedHeader: toSingleHeaderValue(req.headers.forwarded),
    xForwardedForHeader: toSingleHeaderValue(req.headers["x-forwarded-for"]),
    xRealIpHeader: toSingleHeaderValue(req.headers["x-real-ip"]),
    trustedProxies,
  });

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
