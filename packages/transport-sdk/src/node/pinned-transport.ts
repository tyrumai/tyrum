import * as undici from "undici";
import * as tls from "node:tls";
import { normalizeFingerprint256 } from "../tls/fingerprint.js";
import type { TyrumHttpFetch } from "../http/shared.js";

export interface NodePinnedTlsOptions {
  pinRaw: string;
  expectedFingerprint256: string;
  caCertPem?: string;
}

export interface NodePinnedTransportState {
  fetchImpl: TyrumHttpFetch;
  dispatcher: { destroy?: () => Promise<void> | void };
}

export interface NodePinnedWebSocketOptions extends NodePinnedTlsOptions {
  url: string;
  protocols: string[];
  onTransportError?: (message: string) => void;
  onPinFailure?: (message: string) => void;
}

function createTlsPinnedConnect(
  options: NodePinnedTlsOptions & {
    onTransportError?: (message: string) => void;
    onPinFailure?: (message: string) => void;
  },
): (
  opts: { port?: unknown; hostname?: unknown; servername?: unknown },
  callback: (err: Error | null, socket: unknown | null) => void,
) => void {
  const { expectedFingerprint256, pinRaw, caCertPem } = options;

  return (opts, callback) => {
    const port = Number.parseInt(String(opts.port ?? ""), 10);
    const hostname = String(opts.hostname ?? "");
    const servername =
      typeof opts.servername === "string" && opts.servername.trim() ? opts.servername : hostname;

    if (!hostname || !Number.isFinite(port)) {
      callback(new Error("Invalid TLS connector options"), null);
      return;
    }

    let settled = false;
    const done = (err: Error | null, socket: unknown | null) => {
      if (settled) return;
      settled = true;
      callback(err, socket);
    };

    const socket = tls.connect({
      host: hostname,
      port,
      servername,
      ca: caCertPem,
      rejectUnauthorized: true,
    }) as tls.TLSSocket;

    socket.once("error", (err: Error) => {
      options.onTransportError?.(err.message);
      done(err, null);
    });

    socket.once("secureConnect", () => {
      try {
        const cert = socket.getPeerCertificate();
        const identityErr = tls.checkServerIdentity(servername, cert);
        if (identityErr) throw identityErr;

        const actualRaw = typeof cert.fingerprint256 === "string" ? cert.fingerprint256 : "";
        const actual = normalizeFingerprint256(actualRaw);
        if (!actual) {
          throw new Error("TLS peer certificate missing fingerprint256.");
        }
        if (actual !== expectedFingerprint256) {
          throw new Error(
            `TLS certificate fingerprint mismatch (expected ${pinRaw}, got ${actualRaw}).`,
          );
        }

        done(null, socket);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        options.onTransportError?.(error.message);
        options.onPinFailure?.(error.message);
        socket.destroy(error);
        done(error, null);
      }
    });
  };
}

export async function createPinnedNodeTransportState(
  options: NodePinnedTlsOptions,
): Promise<NodePinnedTransportState> {
  const agent = new undici.Agent({
    connect: createTlsPinnedConnect(options) as any,
  });
  return {
    fetchImpl: undici.fetch as unknown as TyrumHttpFetch,
    dispatcher: agent,
  };
}

export async function createPinnedNodeWebSocket(
  options: NodePinnedWebSocketOptions,
): Promise<{ ws: WebSocket; dispatcher: { destroy?: () => Promise<void> | void } }> {
  const agent = new undici.Agent({
    connect: createTlsPinnedConnect(options) as any,
  });

  try {
    const WebSocketCtor = undici.WebSocket as unknown as new (...args: any[]) => WebSocket;
    const ws = new WebSocketCtor(options.url, {
      protocols: options.protocols,
      dispatcher: agent,
    });
    return { ws, dispatcher: agent };
  } catch (err) {
    await Promise.resolve(agent.destroy?.()).catch(() => {});
    throw err;
  }
}

export async function destroyPinnedNodeDispatcher(
  dispatcher: { destroy?: () => Promise<void> | void } | null | undefined,
): Promise<void> {
  if (!dispatcher || typeof dispatcher.destroy !== "function") return;
  await Promise.resolve(dispatcher.destroy()).catch(() => {});
}
