import { WebSocket } from "ws";
import type { Server } from "node:http";
import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";
import {
  buildTranscript,
  completeHandshake,
  computeDeviceId,
  createHandshakeIdentity,
} from "./ws-handshake.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import type { GatewayContainer } from "../../src/container.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createTestContainer } from "./helpers.js";

export {
  buildTranscript,
  completeHandshake,
  computeDeviceId,
  createHandshakeIdentity,
} from "./ws-handshake.js";
export { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
export { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
export { AUTH_COOKIE_NAME } from "../../src/modules/auth/http.js";
export {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
} from "@tyrum/schemas";

export interface TestContext {
  server: Server | undefined;
  setServer(s: Server | undefined): void;
  homeDir: string | undefined;
  setHomeDir(d: string | undefined): void;
  clients: WebSocket[];
  containers: GatewayContainer[];
}

export function authProtocols(token: string): string[] {
  return ["tyrum-v1", `tyrum-auth.${Buffer.from(token, "utf-8").toString("base64url")}`];
}

export function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error("open timeout")), 5_000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export function waitForClose(
  ws: WebSocket,
  timeoutMs = 5_000,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("close timeout")), timeoutMs);
    ws.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString("utf-8") });
    });
  });
}

export function waitForUnexpectedResponse(
  ws: WebSocket,
  timeoutMs = 5_000,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("unexpected response timeout"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      ws.off("open", onOpen);
      ws.off("error", onError);
      ws.off("unexpected-response", onUnexpectedResponse);
    };

    const onOpen = () => {
      cleanup();
      reject(new Error("unexpectedly upgraded connection"));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onUnexpectedResponse = (
      _request: unknown,
      response: NodeJS.ReadableStream & { statusCode?: number },
    ) => {
      let body = "";
      response.setEncoding?.("utf8");
      response.on("data", (chunk: string | Buffer) => {
        body += chunk.toString();
      });
      response.on("end", () => {
        cleanup();
        resolve({ statusCode: response.statusCode ?? 0, body });
      });
      response.on("error", (err) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
      response.resume?.();
    };

    ws.on("open", onOpen);
    ws.on("error", onError);
    ws.on("unexpected-response", onUnexpectedResponse);
  });
}

export function waitForJsonMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("message timeout")), 5_000);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString("utf-8")) as Record<string, unknown>);
    });
  });
}

export function waitForMessageOrClose(
  ws: WebSocket,
  timeoutMs = 5_000,
): Promise<
  | { kind: "close"; code: number; reason: string }
  | { kind: "message"; msg: Record<string, unknown> }
> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("close", onClose);
      ws.off("error", onError);
    };

    const onMessage = (data: unknown) => {
      cleanup();
      try {
        resolve({ kind: "message", msg: JSON.parse(String(data)) as Record<string, unknown> });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    const onClose = (code: number, reason: Buffer) => {
      cleanup();
      resolve({ kind: "close", code, reason: reason.toString("utf-8") });
    };
    const onError = (err: unknown) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    ws.on("message", onMessage);
    ws.on("close", onClose);
    ws.on("error", onError);
  });
}

export function waitForJsonMessageMatching(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 5_000,
  label = "unknown",
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`message timeout (${label})`));
    }, timeoutMs);

    const onMessage = (data: unknown) => {
      try {
        const msg = JSON.parse(String(data)) as Record<string, unknown>;
        if (!predicate(msg)) return;
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(msg);
      } catch {
        // ignore malformed frames
      }
    };

    ws.on("message", onMessage);
  });
}

export function recordJsonMessages(ws: WebSocket): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  ws.on("message", (data) => {
    try {
      messages.push(JSON.parse(String(data)) as Record<string, unknown>);
    } catch {
      // ignore malformed frames
    }
  });
  return messages;
}

export async function createAuthTokens(tyrumHome: string): Promise<{
  container: GatewayContainer;
  authTokens: AuthTokenService;
  tenantAdminToken: string;
}> {
  const container = await createTestContainer({ tyrumHome });
  const authTokens = new AuthTokenService(container.db);
  const issued = await authTokens.issueToken({
    tenantId: DEFAULT_TENANT_ID,
    role: "admin",
    scopes: ["*"],
  });
  return { container, authTokens, tenantAdminToken: issued.token };
}

export async function issueDeviceToken(
  authTokens: AuthTokenService,
  input: {
    deviceId: string;
    role: "client" | "node";
    scopes: string[];
    ttlSeconds: number;
  },
): Promise<string> {
  const issued = await authTokens.issueToken({
    tenantId: DEFAULT_TENANT_ID,
    role: input.role,
    scopes: input.scopes,
    deviceId: input.deviceId,
    ttlSeconds: input.ttlSeconds,
  });
  return issued.token;
}
