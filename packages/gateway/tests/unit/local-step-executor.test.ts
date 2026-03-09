import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ActionPrimitive } from "@tyrum/schemas";
import { Ajv2019 } from "ajv/dist/2019.js";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { McpManager } from "../../src/modules/agent/mcp-manager.js";
import { createLocalStepExecutor } from "../../src/modules/execution/local-step-executor.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { SecretHandle } from "@tyrum/schemas";
import type { SecretProvider } from "../../src/modules/secret/provider.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("LocalStepExecutor playbook output contracts", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await container?.db.close();
    container = undefined;
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  async function makeExecutor() {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-local-step-executor-"));
    return createLocalStepExecutor({ tyrumHome: homeDir });
  }

  async function makePolicyExecutor(input: {
    bundle: Record<string, unknown>;
    secretProvider?: SecretProvider;
  }) {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-local-step-executor-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const snapshot = await container.policyService.getOrCreateSnapshot(
      DEFAULT_TENANT_ID,
      input.bundle,
    );
    const executor = createLocalStepExecutor({
      tyrumHome: homeDir,
      secretProvider: input.secretProvider,
      policyService: container.policyService,
    });
    return {
      executor,
      context: {
        tenantId: DEFAULT_TENANT_ID,
        runId: "run-1",
        stepId: "step-1",
        attemptId: "attempt-1",
        approvalId: null,
        key: "agent:test",
        lane: "main",
        workspaceId: "default",
        policySnapshotId: snapshot.policy_snapshot_id,
      },
    };
  }

  it("shuts down the embedded MCP manager", async () => {
    const shutdownSpy = vi.spyOn(McpManager.prototype, "shutdown").mockResolvedValue(undefined);
    const executor = await makeExecutor();

    await executor.shutdown?.();

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
  });

  it("applies max_output_bytes cap for CLI output", async () => {
    const executor = await makeExecutor();
    const action = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: process.execPath,
        args: ["-e", "process.stdout.write('x'.repeat(64))"],
        max_output_bytes: 16,
      },
    });

    const res = await executor.execute(action, "plan-1", 0, 5_000);
    expect(res.success).toBe(true);
    const result = res.result as { stdout?: string; truncated?: boolean };
    expect(result.stdout).toBe("x".repeat(16));
    expect(result.truncated).toBe(true);
  });

  it("fails when playbook output contract requires JSON but CLI output is text", async () => {
    const executor = await makeExecutor();
    const action = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: process.execPath,
        args: ["-e", "process.stdout.write('not-json')"],
        __playbook: {
          output: "json",
        },
      },
    });

    const res = await executor.execute(action, "plan-2", 0, 5_000);
    expect(res.success).toBe(false);
    expect(res.error).toContain("expected JSON");
  });

  it("fails when playbook output JSON schema validation fails", async () => {
    const executor = await makeExecutor();
    const action = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: process.execPath,
        args: ["-e", "process.stdout.write('{\"ok\":false}')"],
        __playbook: {
          output: {
            type: "json",
            schema: {
              type: "object",
              required: ["ok"],
              properties: {
                ok: { const: true },
              },
              additionalProperties: false,
            },
          },
        },
      },
    });

    const res = await executor.execute(action, "plan-3", 0, 5_000);
    expect(res.success).toBe(false);
    expect(res.error).toContain("schema");
  });

  it("uses a fresh validator instance for each output schema validation", async () => {
    const compileSpy = vi.spyOn(Ajv2019.prototype, "compile");
    const executor = await makeExecutor();

    const first = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: process.execPath,
        args: ["-e", "process.stdout.write('{\"ok\":true}')"],
        __playbook: {
          output: {
            type: "json",
            schema: {
              type: "object",
              required: ["ok"],
              properties: {
                ok: { const: true },
              },
              additionalProperties: false,
            },
          },
        },
      },
    });

    const second = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: process.execPath,
        args: ["-e", 'process.stdout.write(\'{"name":"tyrum"}\')'],
        __playbook: {
          output: {
            type: "json",
            schema: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string" },
              },
              additionalProperties: false,
            },
          },
        },
      },
    });

    const firstRes = await executor.execute(first, "plan-ajv-1", 0, 5_000);
    const secondRes = await executor.execute(second, "plan-ajv-2", 0, 5_000);

    expect(firstRes.success).toBe(true);
    expect(secondRes.success).toBe(true);

    expect(compileSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    const contexts = new Set(
      compileSpy.mock.contexts.filter(
        (ctx): ctx is object => typeof ctx === "object" && ctx !== null,
      ),
    );
    expect(contexts.size).toBeGreaterThanOrEqual(2);
  });

  it("fails when playbook output contract requires JSON but HTTP response is text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("plain text", { status: 200, headers: { "content-type": "text/plain" } }),
      ),
    );

    const executor = await makeExecutor();
    const action = ActionPrimitive.parse({
      type: "Http",
      args: {
        url: "https://1.1.1.1/example",
        method: "GET",
        __playbook: {
          output: "json",
        },
      },
    });

    const res = await executor.execute(action, "plan-4", 0, 5_000);
    expect(res.success).toBe(false);
    expect(res.error).toContain("expected JSON");
  });

  it("fails JSON output contracts when stdout was truncated", async () => {
    const executor = await makeExecutor();
    const action = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: process.execPath,
        args: ["-e", "process.stdout.write('{\"ok\":true} trailing')"],
        max_output_bytes: 11,
        __playbook: {
          output: "json",
        },
      },
    });

    const res = await executor.execute(action, "plan-5", 0, 5_000);
    expect(res.success).toBe(false);
    expect(res.error).toContain("truncated");
  });

  it("accepts JSON output when only stderr was truncated", async () => {
    const executor = await makeExecutor();
    const action = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: process.execPath,
        args: [
          "-e",
          "process.stdout.write('{\"ok\":true}'); process.stderr.write('x'.repeat(64));",
        ],
        max_output_bytes: 16,
        __playbook: {
          output: "json",
        },
      },
    });

    const res = await executor.execute(action, "plan-6", 0, 5_000);
    expect(res.success).toBe(true);
  });

  it("includes parsed JSON evidence when HTTP JSON schema validation fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"ok":false}', {
            status: 422,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const executor = await makeExecutor();
    const action = ActionPrimitive.parse({
      type: "Http",
      args: {
        url: "https://1.1.1.1/example",
        method: "GET",
        __playbook: {
          output: {
            type: "json",
            schema: {
              type: "object",
              required: ["ok"],
              properties: {
                ok: { const: true },
              },
              additionalProperties: false,
            },
          },
        },
      },
    });

    const res = await executor.execute(action, "plan-7", 0, 5_000);
    expect(res.success).toBe(false);
    expect(res.error).toContain("schema");
    expect((res.evidence as { json?: unknown } | undefined)?.json).toEqual({ ok: false });
  });

  it("preserves JSON null output as null evidence", async () => {
    const executor = await makeExecutor();
    const action = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: process.execPath,
        args: ["-e", "process.stdout.write('null')"],
        __playbook: {
          output: "json",
        },
      },
    });

    const res = await executor.execute(action, "plan-8", 0, 5_000);
    expect(res.success).toBe(true);
    const evidence = res.evidence as { json?: unknown } | undefined;
    expect(evidence?.json).toBeNull();
  });

  it("fails closed when policy-governed execution is missing a policy snapshot id", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-local-step-executor-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    const executor = createLocalStepExecutor({
      tyrumHome: homeDir,
      policyService: container.policyService,
    });

    const action = ActionPrimitive.parse({
      type: "CLI",
      args: {
        cmd: process.execPath,
        args: ["-e", "process.stdout.write('ok')"],
      },
    });

    const res = await executor.execute(action, "plan-policy-missing", 0, 5_000, {
      tenantId: DEFAULT_TENANT_ID,
      runId: "run-1",
      stepId: "step-1",
      attemptId: "attempt-1",
      approvalId: null,
      key: "agent:test",
      lane: "main",
      workspaceId: "default",
      policySnapshotId: null,
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("policy snapshot");
  });

  it("denies HTTP execution when executor-side policy rejects egress", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
      ),
    );

    const { executor, context } = await makePolicyExecutor({
      bundle: {
        v: 1,
        tools: { default: "deny", allow: ["webfetch"], require_approval: [], deny: [] },
        network_egress: { default: "deny", allow: [], require_approval: [], deny: [] },
        secrets: { default: "allow", allow: [], require_approval: [], deny: [] },
      },
    });

    const action = ActionPrimitive.parse({
      type: "Http",
      args: {
        url: "https://93.184.216.34/data",
        method: "GET",
      },
    });

    const res = await executor.execute(action, "plan-policy-egress", 0, 5_000, context);

    expect(res.success).toBe(false);
    expect(res.error).toContain("policy denied");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("denies secret resolution before resolving secret values", async () => {
    const handle: SecretHandle = {
      handle_id: "handle-abc",
      provider: "db",
      scope: "billing",
      created_at: new Date().toISOString(),
    };
    const secretProvider: SecretProvider = {
      resolve: vi.fn(async () => "SECRET_VALUE"),
      store: vi.fn(async () => handle),
      revoke: vi.fn(async () => true),
      list: vi.fn(async () => [handle]),
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
      ),
    );

    const { executor, context } = await makePolicyExecutor({
      bundle: {
        v: 1,
        tools: { default: "deny", allow: ["webfetch"], require_approval: [], deny: [] },
        network_egress: {
          default: "deny",
          allow: ["https://93.184.216.34/*"],
          require_approval: [],
          deny: [],
        },
        secrets: { default: "deny", allow: [], require_approval: [], deny: [] },
      },
      secretProvider,
    });

    const action = ActionPrimitive.parse({
      type: "Http",
      args: {
        url: "https://93.184.216.34/data",
        method: "GET",
        headers: { Authorization: "secret:handle-abc" },
      },
    });

    const res = await executor.execute(action, "plan-policy-secret", 0, 5_000, context);

    expect(res.success).toBe(false);
    expect(res.error).toContain("policy denied secret resolution");
    expect(secretProvider.list).toHaveBeenCalled();
    expect(secretProvider.resolve).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
