import { EventEmitter } from "node:events";
import { expect } from "vitest";
import type { BrowserWindow } from "electron";

export class MockGatewayManager extends EventEmitter {
  public status: "stopped" | "starting" | "running" | "error" = "stopped";
  public lastStartOptions: unknown;
  public startCalls = 0;
  public stopCalls = 0;
  public callSequence: string[] = [];
  public bootstrapToken: string | undefined = "tyrum-token.v1.bootstrap.token";
  public issuedDefaultTenantAdminTokenValue = "tyrum-token.v1.issued.token";
  public issueDefaultTenantAdminTokenCalls = 0;

  async start(opts?: unknown): Promise<void> {
    this.lastStartOptions = opts;
    this.startCalls += 1;
    this.callSequence.push("start");
    this.status = "running";
    this.emit("status-change", "running");
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.status = "stopped";
    this.emit("status-change", "stopped");
  }

  getBootstrapToken(label: string): string | undefined {
    if (label === "default-tenant-admin") {
      return this.bootstrapToken;
    }
    return undefined;
  }

  async issueDefaultTenantAdminToken(): Promise<string> {
    this.issueDefaultTenantAdminTokenCalls += 1;
    this.callSequence.push("issueDefaultTenantAdminToken");
    return this.issuedDefaultTenantAdminTokenValue;
  }
}

export function createWindowStub(
  sentEvents?: Array<{ channel: string; payload: unknown }>,
): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        sentEvents?.push({ channel, payload });
      },
    },
  } as unknown as BrowserWindow;
}

export function createOkResponse(): Response {
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export function getRegisteredHandler(
  registeredHandlers: Map<string, (...args: unknown[]) => unknown>,
  channel: string,
): (...args: unknown[]) => unknown {
  const handler = registeredHandlers.get(channel);
  expect(handler).toBeDefined();
  return handler!;
}

let gatewayIpcModulePromise: Promise<typeof import("../src/main/ipc/gateway-ipc.js")> | null = null;

async function loadGatewayIpcModule(): Promise<typeof import("../src/main/ipc/gateway-ipc.js")> {
  gatewayIpcModulePromise ??= import("../src/main/ipc/gateway-ipc.js");
  return await gatewayIpcModulePromise;
}

export async function resetGatewayIpcForTest(): Promise<void> {
  const gatewayIpc = await loadGatewayIpcModule();
  await gatewayIpc.resetGatewayIpcStateForTests();
}

export async function registerGatewayIpcForTest(
  sentEvents?: Array<{ channel: string; payload: unknown }>,
): Promise<{
  ensureEmbeddedGatewayToken: typeof import("../src/main/ipc/gateway-ipc.js").ensureEmbeddedGatewayToken;
  registerGatewayIpc: typeof import("../src/main/ipc/gateway-ipc.js").registerGatewayIpc;
  resolveOperatorConnection: typeof import("../src/main/ipc/gateway-ipc.js").resolveOperatorConnection;
  startEmbeddedGatewayFromConfig: typeof import("../src/main/ipc/gateway-ipc.js").startEmbeddedGatewayFromConfig;
  manager: unknown;
}> {
  const gatewayIpc = await loadGatewayIpcModule();
  const manager = gatewayIpc.registerGatewayIpc(createWindowStub(sentEvents));
  return { ...gatewayIpc, manager };
}

export function expectConnection(
  connection: unknown,
  expected: { mode: "embedded" | "remote"; wsUrl: string; httpBaseUrl: string; token: string },
): void {
  expect(connection).toEqual({
    ...expected,
    tlsCertFingerprint256: "",
    tlsAllowSelfSigned: false,
  });
}
