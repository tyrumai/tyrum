import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, vi } from "vitest";

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:8788";
const DEFAULT_DEVICE = {
  deviceId: "dev",
  publicKey: "pub",
  privateKey: "priv",
};

type MockableClientModule = "@tyrum/operator-app/node" | "@tyrum/transport-sdk/node";
type WsConnectMode = "success" | "transport_error" | "disconnected";
type OperatorCliContext = {
  errSpy: unknown;
  logSpy: unknown;
  runCli: (argv: string[]) => Promise<number>;
};
type OperatorCliOptions = {
  authToken?: string;
  includeDeviceIdentity?: boolean;
};

export const wsCtorSpy = vi.fn();
export const wsConnectMode = { value: "success" as WsConnectMode };
export const wsDisconnectSpy = vi.fn();
export const wsApprovalListSpy = vi.fn();
export const wsApprovalResolveSpy = vi.fn();
export const wsWorkflowRunSpy = vi.fn();
export const wsWorkflowResumeSpy = vi.fn();
export const wsWorkflowCancelSpy = vi.fn();
export const httpCtorSpy = vi.fn();
export const httpPairingsApproveSpy = vi.fn();
export const httpPairingsDenySpy = vi.fn();
export const httpPairingsRevokeSpy = vi.fn();
export const httpSecretsStoreSpy = vi.fn();
export const httpSecretsListSpy = vi.fn();
export const httpSecretsRevokeSpy = vi.fn();
export const httpSecretsRotateSpy = vi.fn();
export const httpPolicyGetBundleSpy = vi.fn();
export const httpPolicyListOverridesSpy = vi.fn();
export const httpPolicyCreateOverrideSpy = vi.fn();
export const httpPolicyRevokeOverrideSpy = vi.fn();

const resettableSpies = [
  wsCtorSpy,
  wsDisconnectSpy,
  wsApprovalListSpy,
  wsApprovalResolveSpy,
  wsWorkflowRunSpy,
  wsWorkflowResumeSpy,
  wsWorkflowCancelSpy,
  httpCtorSpy,
  httpPairingsApproveSpy,
  httpPairingsDenySpy,
  httpPairingsRevokeSpy,
  httpSecretsStoreSpy,
  httpSecretsListSpy,
  httpSecretsRevokeSpy,
  httpSecretsRotateSpy,
  httpPolicyGetBundleSpy,
  httpPolicyListOverridesSpy,
  httpPolicyCreateOverrideSpy,
  httpPolicyRevokeOverrideSpy,
] as const;

// Vitest 4.1 can race per-test doUnmock teardown with the next dynamic import.
// Keep the client mocks active for the file and clean them up once the suite ends.
afterAll(() => {
  vi.doUnmock("@tyrum/operator-app/node");
  vi.doUnmock("@tyrum/transport-sdk/node");
  vi.resetModules();
});

async function createMockClientModule(
  specifier: MockableClientModule,
): Promise<Record<string, unknown>> {
  const actual = await vi.importActual<Record<string, unknown>>(specifier);

  class TyrumClient {
    private readonly handlers = new Map<string, Set<(data: unknown) => void>>();

    constructor(opts: unknown) {
      wsCtorSpy(opts);
    }

    on(event: string, handler: (data: unknown) => void): void {
      const existing = this.handlers.get(event) ?? new Set<(data: unknown) => void>();
      existing.add(handler);
      this.handlers.set(event, existing);
    }

    off(event: string, handler: (data: unknown) => void): void {
      this.handlers.get(event)?.delete(handler);
    }

    private emit(event: string, data: unknown): void {
      for (const handler of this.handlers.get(event) ?? []) handler(data);
    }

    connect(): void {
      if (wsConnectMode.value === "success") {
        queueMicrotask(() => this.emit("connected", { clientId: "test" }));
        return;
      }

      if (wsConnectMode.value === "transport_error") {
        queueMicrotask(() => this.emit("transport_error", { message: "mock transport error" }));
        return;
      }

      queueMicrotask(() => this.emit("disconnected", { code: 1006, reason: "mock disconnect" }));
    }

    disconnect(): void {
      wsDisconnectSpy();
    }

    approvalList(payload?: unknown): Promise<unknown> {
      return wsApprovalListSpy(payload);
    }

    approvalResolve(payload: unknown): Promise<unknown> {
      return wsApprovalResolveSpy(payload);
    }

    workflowRun(payload: unknown): Promise<unknown> {
      return wsWorkflowRunSpy(payload);
    }

    workflowResume(payload: unknown): Promise<unknown> {
      return wsWorkflowResumeSpy(payload);
    }

    workflowCancel(payload: unknown): Promise<unknown> {
      return wsWorkflowCancelSpy(payload);
    }
  }

  return {
    ...actual,
    TyrumClient,
    createTyrumHttpClient: (options: unknown) => {
      httpCtorSpy(options);
      return {
        pairings: {
          approve: httpPairingsApproveSpy,
          deny: httpPairingsDenySpy,
          revoke: httpPairingsRevokeSpy,
        },
        secrets: {
          store: httpSecretsStoreSpy,
          list: httpSecretsListSpy,
          revoke: httpSecretsRevokeSpy,
          rotate: httpSecretsRotateSpy,
        },
        policy: {
          getBundle: httpPolicyGetBundleSpy,
          listOverrides: httpPolicyListOverridesSpy,
          createOverride: httpPolicyCreateOverrideSpy,
          revokeOverride: httpPolicyRevokeOverrideSpy,
        },
      };
    },
  };
}

async function setupOperatorHome({
  authToken = "tkn",
  includeDeviceIdentity = true,
}: OperatorCliOptions = {}): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
  process.env["TYRUM_HOME"] = home;

  const operatorDir = join(home, "operator");
  await mkdir(operatorDir, { recursive: true, mode: 0o700 });
  await writeFile(
    join(operatorDir, "config.json"),
    JSON.stringify({ gateway_url: DEFAULT_GATEWAY_URL, auth_token: authToken }, null, 2),
    { mode: 0o600 },
  );

  if (includeDeviceIdentity) {
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify(DEFAULT_DEVICE, null, 2),
      {
        mode: 0o600,
      },
    );
  }

  return home;
}

async function importRunCli(): Promise<(argv: string[]) => Promise<number>> {
  vi.resetModules();
  vi.doMock(
    "@tyrum/operator-app/node",
    async () => await createMockClientModule("@tyrum/operator-app/node"),
  );
  vi.doMock(
    "@tyrum/transport-sdk/node",
    async () => await createMockClientModule("@tyrum/transport-sdk/node"),
  );
  const { runCli } = (await import("../../src/index.js")) as {
    runCli: (argv: string[]) => Promise<number>;
  };
  return runCli;
}

export function expectBearerHttpCtor(token: string): void {
  expect(httpCtorSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      baseUrl: DEFAULT_GATEWAY_URL,
      auth: { type: "bearer", token },
    }),
  );
}

export function expectDefaultWsCtor(token = "tkn"): void {
  expect(wsCtorSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      url: "ws://127.0.0.1:8788/ws",
      token,
      reconnect: false,
      capabilities: [],
      device: expect.objectContaining(DEFAULT_DEVICE),
    }),
  );
}

export function resetOperatorCommandSpies(): void {
  wsConnectMode.value = "success";
  for (const spy of resettableSpies) spy.mockReset();
}

export function setWsConnectMode(mode: WsConnectMode): void {
  wsConnectMode.value = mode;
}

export async function withOperatorCli<T>(
  options: OperatorCliOptions,
  run: (context: OperatorCliContext) => Promise<T>,
): Promise<T> {
  const home = await setupOperatorHome(options);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    const runCli = await importRunCli();
    return await run({ runCli, logSpy, errSpy });
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    await rm(home, { recursive: true, force: true });
  }
}
