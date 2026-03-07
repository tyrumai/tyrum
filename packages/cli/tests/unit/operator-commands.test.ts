import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  wsCtorSpy,
  wsConnectMode,
  wsDisconnectSpy,
  wsApprovalListSpy,
  wsApprovalResolveSpy,
  wsWorkflowRunSpy,
  wsWorkflowResumeSpy,
  wsWorkflowCancelSpy,
  wsMemorySearchSpy,
  wsMemoryListSpy,
  wsMemoryGetSpy,
  wsMemoryCreateSpy,
  wsMemoryUpdateSpy,
  wsMemoryDeleteSpy,
  wsMemoryForgetSpy,
  wsMemoryExportSpy,
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
} = vi.hoisted(() => ({
  wsCtorSpy: vi.fn(),
  wsConnectMode: { value: "success" as "success" | "transport_error" | "disconnected" },
  wsDisconnectSpy: vi.fn(),
  wsApprovalListSpy: vi.fn(),
  wsApprovalResolveSpy: vi.fn(),
  wsWorkflowRunSpy: vi.fn(),
  wsWorkflowResumeSpy: vi.fn(),
  wsWorkflowCancelSpy: vi.fn(),
  wsMemorySearchSpy: vi.fn(),
  wsMemoryListSpy: vi.fn(),
  wsMemoryGetSpy: vi.fn(),
  wsMemoryCreateSpy: vi.fn(),
  wsMemoryUpdateSpy: vi.fn(),
  wsMemoryDeleteSpy: vi.fn(),
  wsMemoryForgetSpy: vi.fn(),
  wsMemoryExportSpy: vi.fn(),
  httpCtorSpy: vi.fn(),
  httpPairingsApproveSpy: vi.fn(),
  httpPairingsDenySpy: vi.fn(),
  httpPairingsRevokeSpy: vi.fn(),
  httpSecretsStoreSpy: vi.fn(),
  httpSecretsListSpy: vi.fn(),
  httpSecretsRevokeSpy: vi.fn(),
  httpSecretsRotateSpy: vi.fn(),
  httpPolicyGetBundleSpy: vi.fn(),
  httpPolicyListOverridesSpy: vi.fn(),
  httpPolicyCreateOverrideSpy: vi.fn(),
  httpPolicyRevokeOverrideSpy: vi.fn(),
}));

async function createMockClientModule(
  specifier: "@tyrum/client" | "@tyrum/client/node",
): Promise<Record<string, unknown>> {
  const actual = await vi.importActual(specifier);
  class TyrumClient {
    private readonly handlers = new Map<string, Set<(data: unknown) => void>>();

    constructor(opts: unknown) {
      wsCtorSpy(opts);
    }

    on(event: string, handler: (data: unknown) => void): void {
      const existing = this.handlers.get(event) ?? new Set();
      existing.add(handler);
      this.handlers.set(event, existing);
    }

    off(event: string, handler: (data: unknown) => void): void {
      this.handlers.get(event)?.delete(handler);
    }

    private emit(event: string, data: unknown): void {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(data);
      }
    }

    connect(): void {
      switch (wsConnectMode.value) {
        case "success":
          queueMicrotask(() => this.emit("connected", { clientId: "test" }));
          return;
        case "transport_error":
          queueMicrotask(() => this.emit("transport_error", { message: "mock transport error" }));
          return;
        case "disconnected":
          queueMicrotask(() =>
            this.emit("disconnected", { code: 1006, reason: "mock disconnect" }),
          );
          return;
      }
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

    memorySearch(payload: unknown): Promise<unknown> {
      return wsMemorySearchSpy(payload);
    }

    memoryList(payload: unknown): Promise<unknown> {
      return wsMemoryListSpy(payload);
    }

    memoryGet(payload: unknown): Promise<unknown> {
      return wsMemoryGetSpy(payload);
    }

    memoryCreate(payload: unknown): Promise<unknown> {
      return wsMemoryCreateSpy(payload);
    }

    memoryUpdate(payload: unknown): Promise<unknown> {
      return wsMemoryUpdateSpy(payload);
    }

    memoryDelete(payload: unknown): Promise<unknown> {
      return wsMemoryDeleteSpy(payload);
    }

    memoryForget(payload: unknown): Promise<unknown> {
      return wsMemoryForgetSpy(payload);
    }

    memoryExport(payload: unknown): Promise<unknown> {
      return wsMemoryExportSpy(payload);
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

vi.mock("@tyrum/client", async () => await createMockClientModule("@tyrum/client"));
vi.mock("@tyrum/client/node", async () => await createMockClientModule("@tyrum/client/node"));

describe("@tyrum/cli operator commands", () => {
  const prevHome = process.env["TYRUM_HOME"];

  afterEach(() => {
    wsCtorSpy.mockReset();
    wsConnectMode.value = "success";
    wsDisconnectSpy.mockReset();
    wsApprovalListSpy.mockReset();
    wsApprovalResolveSpy.mockReset();
    wsWorkflowRunSpy.mockReset();
    wsWorkflowResumeSpy.mockReset();
    wsWorkflowCancelSpy.mockReset();
    wsMemorySearchSpy.mockReset();
    wsMemoryListSpy.mockReset();
    wsMemoryGetSpy.mockReset();
    wsMemoryCreateSpy.mockReset();
    wsMemoryUpdateSpy.mockReset();
    wsMemoryDeleteSpy.mockReset();
    wsMemoryForgetSpy.mockReset();
    wsMemoryExportSpy.mockReset();
    httpCtorSpy.mockReset();
    httpPairingsApproveSpy.mockReset();
    httpPairingsDenySpy.mockReset();
    httpPairingsRevokeSpy.mockReset();
    httpSecretsStoreSpy.mockReset();
    httpSecretsListSpy.mockReset();
    httpSecretsRevokeSpy.mockReset();
    httpSecretsRotateSpy.mockReset();
    httpPolicyGetBundleSpy.mockReset();
    httpPolicyListOverridesSpy.mockReset();
    httpPolicyCreateOverrideSpy.mockReset();
    httpPolicyRevokeOverrideSpy.mockReset();

    if (prevHome === undefined) delete process.env["TYRUM_HOME"];
    else process.env["TYRUM_HOME"] = prevHome;
  });

  it("runs `approvals list` via @tyrum/client WS", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsApprovalListSpy.mockResolvedValue({ approvals: [] });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["approvals", "list", "--limit", "10"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsCtorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "ws://127.0.0.1:8788/ws",
          token: "tkn",
          reconnect: false,
          capabilities: ["cli"],
          device: expect.objectContaining({
            deviceId: "dev",
            publicKey: "pub",
            privateKey: "priv",
          }),
        }),
      );
      expect(wsApprovalListSpy).toHaveBeenCalledWith({ limit: 10 });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("disconnects the WS client when connect fails", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsConnectMode.value = "transport_error";

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["approvals", "list", "--limit", "10"]);

      expect(code).toBe(1);
      expect(errSpy).toHaveBeenCalled();
      expect(wsApprovalListSpy).not.toHaveBeenCalled();
      expect(wsDisconnectSpy).toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `memory search` via @tyrum/client WS", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsMemorySearchSpy.mockResolvedValue({ v: 1, hits: [] });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["memory", "search", "--query", "hello"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsMemorySearchSpy).toHaveBeenCalledWith({ v: 1, query: "hello" });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("passes optional flags to `memory search` via @tyrum/client WS", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsMemorySearchSpy.mockResolvedValue({ v: 1, hits: [] });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli([
        "memory",
        "search",
        "--query",
        "hello",
        "--limit",
        "5",
        "--cursor",
        "cur",
        "--filter",
        JSON.stringify({ kinds: ["note"] }),
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsMemorySearchSpy).toHaveBeenCalledWith({
        v: 1,
        query: "hello",
        limit: 5,
        cursor: "cur",
        filter: { kinds: ["note"] },
      });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("rejects `memory search` with invalid --filter JSON", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsMemorySearchSpy.mockResolvedValue({ v: 1, hits: [] });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["memory", "search", "--query", "hello", "--filter", "{nope"]);

      expect(code).toBe(1);
      expect(wsMemorySearchSpy).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `memory list` via @tyrum/client WS", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsMemoryListSpy.mockResolvedValue({ v: 1, items: [] });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["memory", "list", "--limit", "10"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsMemoryListSpy).toHaveBeenCalledWith({ v: 1, limit: 10 });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `memory read` via @tyrum/client WS", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsMemoryGetSpy.mockResolvedValue({ v: 1, item: { kind: "note" } });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["memory", "read", "--id", "00000000-0000-0000-0000-000000000001"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsMemoryGetSpy).toHaveBeenCalledWith({
        v: 1,
        memory_item_id: "00000000-0000-0000-0000-000000000001",
      });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `memory create` via @tyrum/client WS", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsMemoryCreateSpy.mockResolvedValue({ v: 1, item: { kind: "note" } });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli([
        "memory",
        "create",
        "--item",
        JSON.stringify({ kind: "note", body_md: "hello" }),
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsMemoryCreateSpy).toHaveBeenCalledWith({
        v: 1,
        item: {
          kind: "note",
          body_md: "hello",
          provenance: { source_kind: "operator", channel: "cli" },
        },
      });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `memory update` via @tyrum/client WS", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsMemoryUpdateSpy.mockResolvedValue({ v: 1, item: { kind: "note" } });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli([
        "memory",
        "update",
        "--id",
        "00000000-0000-0000-0000-000000000001",
        "--patch",
        JSON.stringify({ tags: ["a"] }),
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsMemoryUpdateSpy).toHaveBeenCalledWith({
        v: 1,
        memory_item_id: "00000000-0000-0000-0000-000000000001",
        patch: { tags: ["a"] },
      });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `memory delete` via @tyrum/client WS", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsMemoryDeleteSpy.mockResolvedValue({ v: 1, tombstone: { memory_item_id: "m1" } });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli([
        "memory",
        "delete",
        "--id",
        "00000000-0000-0000-0000-000000000001",
        "--reason",
        "cleanup",
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsMemoryDeleteSpy).toHaveBeenCalledWith({
        v: 1,
        memory_item_id: "00000000-0000-0000-0000-000000000001",
        reason: "cleanup",
      });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `memory forget` via @tyrum/client WS", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsMemoryForgetSpy.mockResolvedValue({ v: 1, deleted_count: 1, tombstones: [] });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const selectors = [{ kind: "id", memory_item_id: "00000000-0000-0000-0000-000000000001" }];
      const code = await runCli([
        "memory",
        "forget",
        "--selectors",
        JSON.stringify(selectors),
        "--confirm",
        "FORGET",
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsMemoryForgetSpy).toHaveBeenCalledWith({
        v: 1,
        confirm: "FORGET",
        selectors,
      });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("rejects `memory forget` when --confirm is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsMemoryForgetSpy.mockResolvedValue({ v: 1, deleted_count: 1, tombstones: [] });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const selectors = [{ kind: "id", memory_item_id: "00000000-0000-0000-0000-000000000001" }];
      const code = await runCli(["memory", "forget", "--selectors", JSON.stringify(selectors)]);

      expect(code).toBe(1);
      expect(wsMemoryForgetSpy).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `memory export` via @tyrum/client WS", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsMemoryExportSpy.mockResolvedValue({ v: 1, artifact_id: "art_1" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["memory", "export", "--include-tombstones"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsMemoryExportSpy).toHaveBeenCalledWith({ v: 1, include_tombstones: true });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("passes filter to `memory export` via @tyrum/client WS", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsMemoryExportSpy.mockResolvedValue({ v: 1, artifact_id: "art_1" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["memory", "export", "--filter", JSON.stringify({ tags: ["t"] })]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsMemoryExportSpy).toHaveBeenCalledWith({
        v: 1,
        filter: { tags: ["t"] },
        include_tombstones: false,
      });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `approvals resolve` via @tyrum/client WS", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    const approvalId = "550e8400-e29b-41d4-a716-446655440000";
    wsApprovalResolveSpy.mockResolvedValue({ approval: { approval_id: approvalId } });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli([
        "approvals",
        "resolve",
        "--approval-id",
        approvalId,
        "--decision",
        "approved",
        "--reason",
        "ok",
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsApprovalResolveSpy).toHaveBeenCalledWith({
        approval_id: approvalId,
        decision: "approved",
        reason: "ok",
      });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `workflow run` via @tyrum/client WS", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsWorkflowRunSpy.mockResolvedValue({ run_id: "run-1" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli([
        "workflow",
        "run",
        "--key",
        "agent:default:main",
        "--steps",
        '[{"type":"Message","args":{"text":"hi"}}]',
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsWorkflowRunSpy).toHaveBeenCalledWith({
        key: "agent:default:main",
        lane: "main",
        steps: [{ type: "Message", args: { text: "hi" } }],
      });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("rejects `workflow run` with an invalid --lane", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsWorkflowRunSpy.mockResolvedValue({ run_id: "run-1" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli([
        "workflow",
        "run",
        "--key",
        "agent:default:main",
        "--lane",
        "nope",
        "--steps",
        '[{"type":"Message","args":{"text":"hi"}}]',
      ]);

      expect(code).toBe(1);
      expect(wsWorkflowRunSpy).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("defaults `workflow run` steps args to {}", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsWorkflowRunSpy.mockResolvedValue({ run_id: "run-1" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli([
        "workflow",
        "run",
        "--key",
        "agent:default:main",
        "--steps",
        '[{"type":"Message"}]',
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsWorkflowRunSpy).toHaveBeenCalledWith({
        key: "agent:default:main",
        lane: "main",
        steps: [{ type: "Message", args: {} }],
      });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `workflow resume` via @tyrum/client WS", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsWorkflowResumeSpy.mockResolvedValue({ run_id: "run-1" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["workflow", "resume", "--token", "resume-token"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsWorkflowResumeSpy).toHaveBeenCalledWith({ token: "resume-token" });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `workflow cancel` via @tyrum/client WS", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );
    await writeFile(
      join(operatorDir, "device-identity.json"),
      JSON.stringify({ deviceId: "dev", publicKey: "pub", privateKey: "priv" }, null, 2),
      { mode: 0o600 },
    );

    wsWorkflowCancelSpy.mockResolvedValue({ run_id: "run-1", cancelled: true });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["workflow", "cancel", "--run-id", "run-1", "--reason", "oops"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsWorkflowCancelSpy).toHaveBeenCalledWith({ run_id: "run-1", reason: "oops" });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `pairing approve` via @tyrum/client HTTP", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );

    httpPairingsApproveSpy.mockResolvedValue({ status: "ok" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli([
        "pairing",
        "approve",
        "--pairing-id",
        "42",
        "--trust-level",
        "local",
        "--capability",
        "tyrum.cli",
        "--reason",
        "ok",
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(httpCtorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "http://127.0.0.1:8788",
          auth: { type: "bearer", token: "tkn" },
        }),
      );
      expect(httpPairingsApproveSpy).toHaveBeenCalledWith(42, {
        trust_level: "local",
        capability_allowlist: [{ id: "tyrum.cli", version: "1.0.0" }],
        reason: "ok",
      });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `pairing deny` via @tyrum/client HTTP", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );

    httpPairingsDenySpy.mockResolvedValue({ status: "ok" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["pairing", "deny", "--pairing-id", "42", "--reason", "no"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(httpPairingsDenySpy).toHaveBeenCalledWith(42, { reason: "no" });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `pairing revoke` via @tyrum/client HTTP", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );

    httpPairingsRevokeSpy.mockResolvedValue({ status: "ok" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["pairing", "revoke", "--pairing-id", "42", "--reason", "bye"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(httpPairingsRevokeSpy).toHaveBeenCalledWith(42, { reason: "bye" });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `secrets list` via @tyrum/client HTTP", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );

    httpSecretsListSpy.mockResolvedValue({ handles: [] });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["secrets", "list", "--elevated-token", "admin"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(httpCtorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "http://127.0.0.1:8788",
          auth: { type: "bearer", token: "admin" },
        }),
      );
      expect(httpSecretsListSpy).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `secrets store` via @tyrum/client HTTP", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "base" }, null, 2),
      { mode: 0o600 },
    );

    httpSecretsStoreSpy.mockResolvedValue({ handle: { handle_id: "h1" } });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli([
        "secrets",
        "store",
        "--secret-key",
        "demo",
        "--value",
        "secret",
        "--elevated-token",
        "admin",
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(httpCtorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "http://127.0.0.1:8788",
          auth: { type: "bearer", token: "admin" },
        }),
      );
      expect(httpSecretsStoreSpy).toHaveBeenCalledWith({
        secret_key: "demo",
        value: "secret",
      });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `secrets revoke` via @tyrum/client HTTP", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "base" }, null, 2),
      { mode: 0o600 },
    );

    httpSecretsRevokeSpy.mockResolvedValue({ revoked: true });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli([
        "secrets",
        "revoke",
        "--handle-id",
        "h1",
        "--elevated-token",
        "admin",
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(httpCtorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "http://127.0.0.1:8788",
          auth: { type: "bearer", token: "admin" },
        }),
      );
      expect(httpSecretsRevokeSpy).toHaveBeenCalledWith("h1");
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("rejects `secrets revoke` when --value is provided", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "base" }, null, 2),
      { mode: 0o600 },
    );

    httpSecretsRevokeSpy.mockResolvedValue({ revoked: true });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli([
        "secrets",
        "revoke",
        "--handle-id",
        "h1",
        "--value",
        "new-secret",
      ]);

      expect(code).toBe(1);
      expect(httpSecretsRevokeSpy).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("--value"));
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `secrets rotate` via @tyrum/client HTTP", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );

    httpSecretsRotateSpy.mockResolvedValue({ revoked: true, handle: { handle_id: "h2" } });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli([
        "secrets",
        "rotate",
        "--handle-id",
        "h1",
        "--value",
        "new",
        "--elevated-token",
        "admin",
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(httpCtorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "http://127.0.0.1:8788",
          auth: { type: "bearer", token: "admin" },
        }),
      );
      expect(httpSecretsRotateSpy).toHaveBeenCalledWith("h1", { value: "new" });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `policy bundle` via @tyrum/client HTTP", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "base" }, null, 2),
      { mode: 0o600 },
    );

    httpPolicyGetBundleSpy.mockResolvedValue({ status: "ok" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["policy", "bundle", "--elevated-token", "admin"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(httpCtorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "http://127.0.0.1:8788",
          auth: { type: "bearer", token: "admin" },
        }),
      );
      expect(httpPolicyGetBundleSpy).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `policy overrides list` via @tyrum/client HTTP", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "base" }, null, 2),
      { mode: 0o600 },
    );

    httpPolicyListOverridesSpy.mockResolvedValue({ overrides: [] });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["policy", "overrides", "list", "--elevated-token", "admin"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(httpCtorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "http://127.0.0.1:8788",
          auth: { type: "bearer", token: "admin" },
        }),
      );
      expect(httpPolicyListOverridesSpy).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `policy overrides create` via @tyrum/client HTTP", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "base" }, null, 2),
      { mode: 0o600 },
    );

    httpPolicyCreateOverrideSpy.mockResolvedValue({ override: { policy_override_id: "p1" } });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli([
        "policy",
        "overrides",
        "create",
        "--agent-id",
        "default",
        "--tool-id",
        "system.shell.exec",
        "--pattern",
        "*",
        "--elevated-token",
        "admin",
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(httpCtorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "http://127.0.0.1:8788",
          auth: { type: "bearer", token: "admin" },
        }),
      );
      expect(httpPolicyCreateOverrideSpy).toHaveBeenCalledWith({
        agent_id: "default",
        tool_id: "system.shell.exec",
        pattern: "*",
      });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("runs `policy overrides revoke` via @tyrum/client HTTP", async () => {
    const home = await mkdtemp(join(tmpdir(), "tyrum-cli-"));
    process.env["TYRUM_HOME"] = home;

    const operatorDir = join(home, "operator");
    await mkdir(operatorDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(operatorDir, "config.json"),
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "base" }, null, 2),
      { mode: 0o600 },
    );

    httpPolicyRevokeOverrideSpy.mockResolvedValue({ override: { policy_override_id: "p1" } });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli([
        "policy",
        "overrides",
        "revoke",
        "--policy-override-id",
        "p1",
        "--reason",
        "bad",
        "--elevated-token",
        "admin",
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(httpCtorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "http://127.0.0.1:8788",
          auth: { type: "bearer", token: "admin" },
        }),
      );
      expect(httpPolicyRevokeOverrideSpy).toHaveBeenCalledWith({
        policy_override_id: "p1",
        reason: "bad",
      });
      expect(logSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      await rm(home, { recursive: true, force: true });
    }
  });
});
