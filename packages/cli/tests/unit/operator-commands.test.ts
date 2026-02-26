import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  wsCtorSpy,
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
} = vi.hoisted(() => ({
  wsCtorSpy: vi.fn(),
  wsApprovalListSpy: vi.fn(),
  wsApprovalResolveSpy: vi.fn(),
  wsWorkflowRunSpy: vi.fn(),
  wsWorkflowResumeSpy: vi.fn(),
  wsWorkflowCancelSpy: vi.fn(),
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

vi.mock("@tyrum/client", async () => {
  const actual = await vi.importActual<typeof import("@tyrum/client")>("@tyrum/client");

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
      queueMicrotask(() => this.emit("connected", { clientId: "test" }));
    }

    disconnect(): void {}

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
});

describe("@tyrum/cli operator commands", () => {
  const prevHome = process.env["TYRUM_HOME"];

  afterEach(() => {
    wsCtorSpy.mockReset();
    wsApprovalListSpy.mockReset();
    wsApprovalResolveSpy.mockReset();
    wsWorkflowRunSpy.mockReset();
    wsWorkflowResumeSpy.mockReset();
    wsWorkflowCancelSpy.mockReset();
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

    wsApprovalResolveSpy.mockResolvedValue({ approval: { approval_id: 123 } });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli([
        "approvals",
        "resolve",
        "--approval-id",
        "123",
        "--decision",
        "approved",
        "--reason",
        "ok",
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(wsApprovalResolveSpy).toHaveBeenCalledWith({
        approval_id: 123,
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

      const code = await runCli(["secrets", "list"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
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
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
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
        "--scope",
        "demo",
        "--provider",
        "env",
        "--value",
        "secret",
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(httpSecretsStoreSpy).toHaveBeenCalledWith({
        scope: "demo",
        provider: "env",
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
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );

    httpSecretsRevokeSpy.mockResolvedValue({ revoked: true });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["secrets", "revoke", "--handle-id", "h1"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(httpSecretsRevokeSpy).toHaveBeenCalledWith("h1");
      expect(logSpy).toHaveBeenCalled();
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

      const code = await runCli(["secrets", "rotate", "--handle-id", "h1", "--value", "new"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
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
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );

    httpPolicyGetBundleSpy.mockResolvedValue({ status: "ok" });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["policy", "bundle"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
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
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
      { mode: 0o600 },
    );

    httpPolicyListOverridesSpy.mockResolvedValue({ overrides: [] });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      vi.resetModules();
      const { runCli } = await import("../../src/index.js");

      const code = await runCli(["policy", "overrides", "list"]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
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
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
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
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
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
      JSON.stringify({ gateway_url: "http://127.0.0.1:8788", auth_token: "tkn" }, null, 2),
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
      ]);

      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
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
