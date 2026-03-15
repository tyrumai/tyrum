import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SecretHandle } from "@tyrum/schemas";
import { ActionPrimitive } from "@tyrum/schemas";
import type { GatewayContainer } from "../../src/container.js";
import { createLocalStepExecutor } from "../../src/modules/execution/local-step-executor.js";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID } from "../../src/modules/identity/scope.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";

describe("LocalStepExecutor policy enforcement", () => {
  let homeDir: string | undefined;

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  async function makeMockedPolicyExecutor(input: {
    secretsDecision: "allow" | "require_approval" | "deny";
    toolDecision: "allow" | "require_approval" | "deny";
    isPolicyApprovalApproved?: boolean;
  }) {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-local-step-executor-policy-"));
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
    const evaluateSecretsFromSnapshot = vi.fn(async () => ({
      decision: input.secretsDecision,
    }));
    const evaluateToolCallFromSnapshot = vi.fn(async () => ({
      decision: input.toolDecision,
      applied_override_ids: [],
    }));
    const executor = createLocalStepExecutor({
      tyrumHome: homeDir,
      secretProvider,
      policyService: {
        isEnabled: () => true,
        isObserveOnly: () => false,
        evaluateSecretsFromSnapshot,
        evaluateToolCallFromSnapshot,
      } as unknown as GatewayContainer["policyService"],
      isPolicyApprovalApproved: async () => input.isPolicyApprovalApproved ?? false,
    });

    return { executor, evaluateSecretsFromSnapshot, evaluateToolCallFromSnapshot };
  }

  function policyContext(approvalId: string | null) {
    return {
      tenantId: DEFAULT_TENANT_ID,
      runId: "run-1",
      stepId: "step-1",
      attemptId: "attempt-1",
      approvalId,
      agentId: "00000000-0000-4000-8000-000000000002",
      key: "agent:test",
      lane: "main",
      workspaceId: DEFAULT_WORKSPACE_ID,
      policySnapshotId: "policy-1",
    };
  }

  function secretBackedHttpAction() {
    return ActionPrimitive.parse({
      type: "Http",
      args: {
        url: "https://93.184.216.34/data",
        method: "GET",
        headers: { Authorization: "secret:handle-abc" },
      },
    });
  }

  function exaSearchAction() {
    return ActionPrimitive.parse({
      type: "Mcp",
      args: {
        server_id: "exa",
        tool_name: "web_search_exa",
        input: { query: "hello world" },
      },
    });
  }

  it("passes resolved secret scopes into executor-side tool-call policy evaluation", async () => {
    const { executor, evaluateSecretsFromSnapshot, evaluateToolCallFromSnapshot } =
      await makeMockedPolicyExecutor({
        secretsDecision: "allow",
        toolDecision: "allow",
      });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
      ),
    );

    const res = await executor.execute(
      secretBackedHttpAction(),
      "plan-policy-secret-scopes",
      0,
      5_000,
      policyContext(null),
    );

    expect(res.success).toBe(true);
    expect(evaluateSecretsFromSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ secretScopes: ["db:billing"] }),
    );
    expect(evaluateToolCallFromSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ secretScopes: ["db:billing"] }),
    );
  });

  it("uses the execution context agent id for executor-side tool policy evaluation", async () => {
    const { executor, evaluateToolCallFromSnapshot } = await makeMockedPolicyExecutor({
      secretsDecision: "allow",
      toolDecision: "allow",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
      ),
    );

    const res = await executor.execute(
      secretBackedHttpAction(),
      "plan-policy-agent-id",
      0,
      5_000,
      policyContext(null),
    );

    expect(res.success).toBe(true);
    expect(evaluateToolCallFromSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "00000000-0000-4000-8000-000000000002",
      }),
    );
  });

  it("preserves builtin MCP read-only effects during workflow policy evaluation", async () => {
    const { executor, evaluateToolCallFromSnapshot } = await makeMockedPolicyExecutor({
      secretsDecision: "allow",
      toolDecision: "deny",
    });

    const res = await executor.execute(
      exaSearchAction(),
      "plan-policy-mcp-effect",
      0,
      5_000,
      policyContext(null),
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("policy denied websearch");
    expect(evaluateToolCallFromSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "websearch",
        toolEffect: "read_only",
      }),
    );
  });

  it("still denies tool calls after an approved secret gate", async () => {
    const { executor, evaluateSecretsFromSnapshot, evaluateToolCallFromSnapshot } =
      await makeMockedPolicyExecutor({
        secretsDecision: "require_approval",
        toolDecision: "deny",
        isPolicyApprovalApproved: true,
      });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
      ),
    );

    const res = await executor.execute(
      secretBackedHttpAction(),
      "plan-policy-approved-secret-gate",
      0,
      5_000,
      policyContext("approval-1"),
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("policy denied webfetch");
    expect(evaluateSecretsFromSnapshot).toHaveBeenCalled();
    expect(evaluateToolCallFromSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ secretScopes: ["db:billing"] }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("includes suggested overrides in policy approval pauses for tool-matched steps", async () => {
    const { executor } = await makeMockedPolicyExecutor({
      secretsDecision: "allow",
      toolDecision: "require_approval",
    });

    const result = await executor.execute(
      ActionPrimitive.parse({
        type: "Http",
        args: { url: "https://example.com/data", method: "GET" },
      }),
      "plan-policy-approval-context",
      0,
      5_000,
      policyContext(null),
    );

    expect(result.success).toBe(true);
    expect(result.pause).toMatchObject({
      kind: "policy",
      prompt: "Policy approval required to continue execution",
      context: {
        source: "execution-engine",
        tool_id: "webfetch",
        tool_match_target: "https://example.com/data",
        decision: "require_approval",
        policy: {
          policy_snapshot_id: "policy-1",
          workspace_id: DEFAULT_WORKSPACE_ID,
          suggested_overrides: [
            {
              tool_id: "webfetch",
              pattern: "https://example.com/data",
              workspace_id: DEFAULT_WORKSPACE_ID,
            },
          ],
        },
      },
    });
  });
});
