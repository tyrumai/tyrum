import { describe, expect, it } from "vitest";
import type { Decision } from "@tyrum/contracts";
import { createHarnessApprovalRouter } from "../../src/modules/harness/approval-router.js";
import { harnessArg, type HarnessToolMap } from "../../src/modules/harness/tool-mapping.js";
import type { HarnessTurnContext } from "../../src/modules/harness/types.js";
import type { ApprovalDal, ApprovalStatus } from "../../src/modules/approval/dal.js";
import type { PolicyService } from "@tyrum/runtime-policy";

const TOOL_MAP: HarnessToolMap = {
  Bash: {
    toolId: "bash",
    effect: "state_changing",
    toPolicyArgs: harnessArg.passthrough("command"),
  },
  Read: {
    toolId: "read",
    effect: "read_only",
    toPolicyArgs: harnessArg.path("file_path"),
    pathArg: "file_path",
  },
  Write: {
    toolId: "write",
    effect: "state_changing",
    toPolicyArgs: harnessArg.path("file_path"),
    pathArg: "file_path",
  },
};

const CONTEXT: HarnessTurnContext = {
  backendId: "claude_agent_sdk",
  tenantId: "tenant-1",
  agentId: "agent-1",
  workspaceId: "workspace-1",
  conversationId: "conv-1",
  conversationKey: "conv-key-1",
  channel: "web",
  threadId: "thread-1",
  turnId: "turn-1",
  workspaceRoot: "/workspace",
};

const SILENT_LOGGER = { info: () => {}, warn: () => {} };

function fakePolicyService(
  decision: Decision,
  seen?: Array<Record<string, unknown>>,
): PolicyService {
  return {
    evaluateToolCall: async (params: Record<string, unknown>) => {
      seen?.push(params);
      return { decision };
    },
    isObserveOnly: () => false,
    loadEffectiveBundle: async () => {
      throw new Error("not needed for this test");
    },
  } as unknown as PolicyService;
}

/** Minimal approval store: records creation and replays a scripted resolution. */
function fakeApprovalDal(script: {
  status: ApprovalStatus;
  reason?: string;
  /** Overrides the stored context, to simulate a colliding/stale approval. */
  storedContext?: Record<string, unknown>;
}) {
  const created: Array<Record<string, unknown>> = [];
  let reads = 0;
  const matchingContext: Record<string, unknown> = {
    source: "harness-tool-execution",
    tool_call_id: "call-1",
    tool_id: "bash",
    tool_match_target: "rm -rf build",
  };
  const row = (status: ApprovalStatus) => ({
    approval_id: "approval-1",
    tenant_id: CONTEXT.tenantId,
    status,
    prompt: "Approve execution of 'Bash' (bash)",
    created_at: "2026-07-24T00:00:00.000Z",
    expires_at: "2026-07-24T00:05:00.000Z",
    context: script.storedContext ?? matchingContext,
    latest_review: script.reason ? { reason: script.reason } : null,
  });

  const dal = {
    create: async (params: Record<string, unknown>) => {
      created.push(params);
      return row("awaiting_human");
    },
    transitionWithReview: async () => undefined,
    expireStale: async () => 0,
    expireById: async () => row("expired"),
    getById: async () => {
      reads += 1;
      // Stay pending for one poll so the wait loop is genuinely exercised.
      return reads < 2 ? row("awaiting_human") : row(script.status);
    },
  } as unknown as ApprovalDal;

  return { dal, created };
}

function routerFor(input: {
  decision: Decision;
  script?: { status: ApprovalStatus; reason?: string; storedContext?: Record<string, unknown> };
  /** Runs on each poll, so a test can flip an abort signal mid-wait. */
  onSleep?: () => void;
}) {
  const approvals = fakeApprovalDal(input.script ?? { status: "approved" });
  const evaluated: Array<Record<string, unknown>> = [];
  const router = createHarnessApprovalRouter({
    policyService: fakePolicyService(input.decision, evaluated),
    approvalDal: approvals.dal,
    toolMap: TOOL_MAP,
    approvalWaitMs: 10_000,
    approvalPollMs: 1,
    logger: SILENT_LOGGER,
    sleep: async () => void input.onSleep?.(),
  });
  return { router, approvals, evaluated };
}

const BASH_CALL = {
  callId: "call-1",
  toolName: "Bash",
  input: { command: "rm -rf build" },
};

describe("createHarnessApprovalRouter", () => {
  it("allows without creating an approval when policy allows", async () => {
    const { router, approvals } = routerFor({ decision: "allow" });
    const decision = await router.evaluate({ call: BASH_CALL, context: CONTEXT });
    expect(decision.kind).toBe("allow");
    expect(approvals.created).toHaveLength(0);
  });

  it("denies without creating an approval when policy denies", async () => {
    const { router, approvals } = routerFor({ decision: "deny" });
    const decision = await router.evaluate({ call: BASH_CALL, context: CONTEXT });
    expect(decision).toMatchObject({ kind: "deny" });
    expect(approvals.created).toHaveLength(0);
  });

  it("creates a durable approval and resumes the call once approved", async () => {
    const { router, approvals } = routerFor({
      decision: "require_approval",
      script: { status: "approved" },
    });
    const pending: Array<{ callId: string; approvalId: string }> = [];

    const decision = await router.evaluate({
      call: BASH_CALL,
      context: CONTEXT,
      sessionRef: "session-abc",
      onApprovalPending: (input) => {
        pending.push(input);
      },
    });

    expect(decision).toEqual({ kind: "allow", approvalId: "approval-1" });
    expect(pending).toEqual([{ callId: "call-1", approvalId: "approval-1" }]);
    expect(approvals.created).toHaveLength(1);

    // The approval must carry the evidence ARCH-22 requires for harness calls.
    const context = approvals.created[0]?.["context"] as Record<string, unknown>;
    expect(context["source"]).toBe("harness-tool-execution");
    expect(context["backend_id"]).toBe("claude_agent_sdk");
    expect(context["harness_session_ref"]).toBe("session-abc");
    expect(context["harness_tool_name"]).toBe("Bash");
    expect(context["tool_id"]).toBe("bash");
    expect(context["tool_match_target"]).toBe("rm -rf build");
    expect(context["args"]).toEqual({ command: "rm -rf build" });
  });

  it("propagates an operator denial with its reason", async () => {
    const { router } = routerFor({
      decision: "require_approval",
      script: { status: "denied", reason: "too destructive" },
    });
    const decision = await router.evaluate({ call: BASH_CALL, context: CONTEXT });
    expect(decision).toEqual({
      kind: "deny",
      reason: "too destructive",
      approvalId: "approval-1",
    });
  });

  it("denies when the approval expires unresolved", async () => {
    const { router } = routerFor({
      decision: "require_approval",
      script: { status: "expired" },
    });
    const decision = await router.evaluate({ call: BASH_CALL, context: CONTEXT });
    expect(decision).toMatchObject({ kind: "deny", approvalId: "approval-1" });
  });

  it.each<Decision>(["require_approval", "deny"])(
    "observes rather than enforces a %s decision in observe-only mode",
    async (decision) => {
      const approvals = fakeApprovalDal({ status: "approved" });
      const policyService = {
        evaluateToolCall: async () => ({ decision }),
        isObserveOnly: () => true,
      } as unknown as PolicyService;

      const router = createHarnessApprovalRouter({
        policyService,
        approvalDal: approvals.dal,
        toolMap: TOOL_MAP,
        approvalWaitMs: 10_000,
        approvalPollMs: 1,
        logger: SILENT_LOGGER,
        sleep: async () => {},
      });

      // The native path gates deny and require_approval alike on
      // `!isObserveOnly()`; switching backends must not start enforcing.
      const result = await router.evaluate({ call: BASH_CALL, context: CONTEXT });
      expect(result.kind).toBe("allow");
      expect(approvals.created).toHaveLength(0);
    },
  );

  it("carries suggested overrides so the operator can approve-always", async () => {
    const { router, approvals } = routerFor({
      decision: "require_approval",
      script: { status: "approved" },
    });
    await router.evaluate({ call: BASH_CALL, context: CONTEXT });

    const context = approvals.created[0]?.["context"] as Record<string, unknown>;
    const policy = context["policy"] as Record<string, unknown>;
    expect(policy["suggested_overrides"]).toEqual([
      { tool_id: "bash", pattern: "rm -rf build", workspace_id: "workspace-1" },
    ]);
  });

  it("scopes the approval key to the turn and the request fingerprint", async () => {
    const { router, approvals } = routerFor({
      decision: "require_approval",
      script: { status: "approved" },
    });
    await router.evaluate({ call: BASH_CALL, context: CONTEXT });

    const key = String(approvals.created[0]?.["approvalKey"]);
    expect(key.startsWith("harness:claude_agent_sdk:conv-1:turn-1:call-1:")).toBe(true);
    // A fingerprint of the resolved tool identity, so a reused call id cannot
    // collide onto an unrelated approval.
    expect(key.split(":").at(-1)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("refuses an approved record whose recorded tool identity differs", async () => {
    const { router } = routerFor({
      decision: "require_approval",
      script: {
        status: "approved",
        // A stale approval for a different call that collided onto this key.
        storedContext: {
          source: "harness-tool-execution",
          tool_call_id: "call-1",
          tool_id: "bash",
          tool_match_target: "echo hello",
        },
      },
    });

    const decision = await router.evaluate({ call: BASH_CALL, context: CONTEXT });
    expect(decision).toEqual({
      kind: "deny",
      reason: "approval does not match this tool call",
      approvalId: "approval-1",
    });
  });
});

describe("workspace confinement", () => {
  it("refuses a read whose path escapes the workspace", async () => {
    // `read` is read_only, so policy would allow it outright; the native path
    // still refuses it in `assertSandboxed`. The harness path is the only one
    // that actually performs the read, so the router must refuse it too.
    const { router, approvals, evaluated } = routerFor({ decision: "allow" });

    const decision = await router.evaluate({
      call: { callId: "call-2", toolName: "Read", input: { file_path: "/etc/passwd" } },
      context: CONTEXT,
    });

    expect(decision).toMatchObject({ kind: "deny" });
    expect(String((decision as { reason: string }).reason)).toContain("path escapes workspace");
    expect(evaluated).toHaveLength(0);
    expect(approvals.created).toHaveLength(0);
  });

  it("refuses a relative path that climbs out of the workspace", async () => {
    const { router } = routerFor({ decision: "allow" });
    const decision = await router.evaluate({
      call: { callId: "call-3", toolName: "Write", input: { file_path: "../../.ssh/config" } },
      context: CONTEXT,
    });
    expect(decision).toMatchObject({ kind: "deny" });
  });

  it("admits a path inside the workspace", async () => {
    const { router } = routerFor({ decision: "allow" });
    const decision = await router.evaluate({
      call: { callId: "call-4", toolName: "Read", input: { file_path: "docs/plan.md" } },
      context: CONTEXT,
    });
    expect(decision).toEqual({ kind: "allow" });
  });

  it("refuses an escaping path even in observe-only mode", async () => {
    const approvals = fakeApprovalDal({ status: "approved" });
    const router = createHarnessApprovalRouter({
      policyService: {
        evaluateToolCall: async () => ({ decision: "allow" as Decision }),
        isObserveOnly: () => true,
      } as unknown as PolicyService,
      approvalDal: approvals.dal,
      toolMap: TOOL_MAP,
      approvalWaitMs: 10_000,
      approvalPollMs: 1,
      logger: SILENT_LOGGER,
      sleep: async () => {},
    });

    // Observe-only is a *policy* posture. The native sandbox check throws
    // regardless of it, so confinement is not softened either.
    const decision = await router.evaluate({
      call: { callId: "call-5", toolName: "Read", input: { file_path: "/etc/shadow" } },
      context: CONTEXT,
    });
    expect(decision).toMatchObject({ kind: "deny" });
  });

  it("withholds a suggested override for a collapsed match target", async () => {
    const { router, approvals } = routerFor({
      decision: "require_approval",
      script: { status: "approved" },
    });

    await router.evaluate({
      // Canonicalizes to the bare prefix `write:`; an override minted from it
      // would match every later write the canonicalizer collapsed the same way.
      call: { callId: "call-6", toolName: "Write", input: { file_path: "" } },
      context: CONTEXT,
    });

    const context = approvals.created[0]?.["context"] as Record<string, unknown>;
    const policy = context["policy"] as Record<string, unknown>;
    expect(context["tool_match_target"]).toBe("write:");
    expect(policy["suggested_overrides"]).toEqual([]);
  });
});

describe("role ceiling", () => {
  const SHARED_MODE_CONTEXT: HarnessTurnContext = {
    ...CONTEXT,
    roleCeiling: {
      stateMode: "shared",
      toolAllowlist: ["read", "write", "edit", "bash", "glob", "grep"],
    },
  };

  it("denies a filesystem or shell builtin outside local state mode", async () => {
    const { router, approvals, evaluated } = routerFor({ decision: "require_approval" });

    const decision = await router.evaluate({
      call: BASH_CALL,
      context: SHARED_MODE_CONTEXT,
    });

    // Natively this is an unconditional deny, not an approvable prompt.
    expect(decision).toMatchObject({ kind: "deny" });
    expect(approvals.created).toHaveLength(0);
    expect(evaluated[0]?.["roleAllowed"]).toBe(false);
  });

  it("denies a tool the execution profile does not list", async () => {
    const { router, approvals } = routerFor({ decision: "require_approval" });

    const decision = await router.evaluate({
      call: BASH_CALL,
      context: {
        ...CONTEXT,
        roleCeiling: { stateMode: "local", toolAllowlist: ["read", "glob", "grep"] },
      },
    });

    expect(decision).toMatchObject({ kind: "deny" });
    expect(approvals.created).toHaveLength(0);
  });

  it("passes a listed tool through with roleAllowed true", async () => {
    const { router, evaluated } = routerFor({ decision: "allow" });

    const decision = await router.evaluate({
      call: BASH_CALL,
      context: {
        ...CONTEXT,
        roleCeiling: { stateMode: "local", toolAllowlist: ["read", "bash"] },
      },
    });

    expect(decision).toEqual({ kind: "allow" });
    expect(evaluated[0]?.["roleAllowed"]).toBe(true);
  });
});

describe("createHarnessApprovalRouter cancellation", () => {
  it("does not mint an approval for a turn that is already cancelled", async () => {
    const { router, approvals } = routerFor({ decision: "require_approval" });
    const controller = new AbortController();
    controller.abort();

    const decision = await router.evaluate({
      call: BASH_CALL,
      context: CONTEXT,
      abortSignal: controller.signal,
    });

    expect(decision.kind).toBe("deny");
    // An approval for an abandoned turn is one no operator can usefully act on.
    expect(approvals.created).toHaveLength(0);
  });

  it("stops waiting and fails closed when the turn is cancelled mid-wait", async () => {
    const controller = new AbortController();
    const { router, approvals } = routerFor({
      decision: "require_approval",
      // The approval never resolves; only the cancellation ends the wait.
      script: { status: "awaiting_human" },
      onSleep: () => controller.abort(),
    });

    const decision = await router.evaluate({
      call: BASH_CALL,
      context: CONTEXT,
      abortSignal: controller.signal,
    });

    // Waiting runs to approvalWaitMs otherwise, holding the harness's
    // permission callback open long after the turn was abandoned.
    expect(decision).toMatchObject({ kind: "deny", approvalId: "approval-1" });
    expect(approvals.created).toHaveLength(1);
  });

  it("still resolves normally when no cancellation signal is supplied", async () => {
    const { router } = routerFor({ decision: "require_approval", script: { status: "approved" } });
    const decision = await router.evaluate({ call: BASH_CALL, context: CONTEXT });
    expect(decision.kind).toBe("allow");
  });
});
