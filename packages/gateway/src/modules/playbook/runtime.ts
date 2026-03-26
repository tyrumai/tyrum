import type {
  Playbook,
  PlaybookRuntimeEnvelope as PlaybookRuntimeEnvelopeT,
} from "@tyrum/contracts";
import { PlaybookManifest, PolicyBundle } from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ExecutionEngine } from "../execution/engine.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { ApprovalDal, ApprovalRow } from "../approval/dal.js";
import type { SqlDb } from "../../statestore/types.js";
import type { PlaybookRunner } from "./runner.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function isValidationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  return name === "ZodError" || name === "YAMLParseError" || name === "PlaybookCompileError";
}

function resolvePlaybookFromPipeline(pipeline: string, loaded: Playbook[]): Playbook {
  const trimmed = pipeline.trim();

  const byId = loaded.find((p) => p.manifest.id === trimmed);
  if (byId) return byId;

  if (isAbsolute(trimmed)) {
    const normalized = resolve(trimmed);
    const byPath = loaded.find((p) => p.file_path === normalized);
    if (byPath) return byPath;
    throw new Error("playbook file path is not loaded");
  }

  const parsed = parseYaml(trimmed) as unknown;
  const manifest = PlaybookManifest.parse(parsed);
  return {
    manifest,
    file_path: "<inline>",
    loaded_at: new Date().toISOString(),
  };
}

export function resolvePlaybookPolicyBundle(playbook: Playbook) {
  const allowed = playbook.manifest.allowed_domains ?? [];
  if (allowed.length === 0) return undefined;
  return PolicyBundle.parse({
    v: 1,
    network_egress: {
      default: "require_approval",
      allow: allowed.flatMap((d) => [`https://${d}/*`, `http://${d}/*`]),
      require_approval: [],
      deny: [],
    },
  });
}

async function loadPendingApprovalForRun(
  db: SqlDb,
  runId: string,
): Promise<
  | {
      prompt: string;
      resumeToken: string;
    }
  | undefined
> {
  const row = await db.get<{ prompt: string; resume_token: string | null }>(
    `SELECT prompt, resume_token
     FROM approvals
     WHERE tenant_id = ?
       AND turn_id = ?
       AND status IN ('queued', 'reviewing', 'awaiting_human')
     ORDER BY created_at DESC
     LIMIT 1`,
    [DEFAULT_TENANT_ID, runId],
  );
  const resumeToken = row?.resume_token?.trim();
  if (!row?.prompt || !resumeToken) return undefined;
  return { prompt: row.prompt, resumeToken };
}

async function loadRunErrorMessage(db: SqlDb, runId: string): Promise<string | undefined> {
  const row = await db.get<{ error: string | null }>(
    `SELECT a.error
     FROM execution_attempts a
     JOIN execution_steps s ON s.step_id = a.step_id
     WHERE s.turn_id = ? AND a.error IS NOT NULL
     ORDER BY a.started_at DESC
     LIMIT 1`,
    [runId],
  );
  const message = row?.error?.trim();
  return message && message.length > 0 ? message : undefined;
}

async function waitForRunToSettle(
  db: SqlDb,
  runId: string,
  timeoutMs: number,
): Promise<{ status: string; paused_reason: string | null; paused_detail: string | null }> {
  const deadline = Date.now() + Math.max(1, timeoutMs);

  for (;;) {
    const row = await db.get<{
      status: string;
      paused_reason: string | null;
      paused_detail: string | null;
    }>(
      "SELECT status, blocked_reason AS paused_reason, blocked_detail AS paused_detail FROM turns WHERE turn_id = ?",
      [runId],
    );
    if (!row) {
      throw new Error(`execution run '${runId}' not found`);
    }

    if (
      row.status === "paused" ||
      row.status === "succeeded" ||
      row.status === "failed" ||
      row.status === "cancelled"
    ) {
      return row;
    }

    if (Date.now() >= deadline) {
      throw new Error(`execution run '${runId}' did not settle within ${String(timeoutMs)}ms`);
    }

    await sleep(25);
  }
}

async function waitForRunToResumeOrCancel(
  db: SqlDb,
  runId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + Math.max(1, timeoutMs);

  for (;;) {
    const row = await db.get<{ status: string }>("SELECT status FROM turns WHERE turn_id = ?", [
      runId,
    ]);
    if (!row) {
      throw new Error(`execution run '${runId}' not found`);
    }

    if (row.status !== "paused") return;

    const pendingApproval = await db.get<{ n: number }>(
      `SELECT 1 AS n
       FROM approvals
       WHERE tenant_id = ?
         AND turn_id = ?
         AND status IN ('queued', 'reviewing', 'awaiting_human')
       LIMIT 1`,
      [DEFAULT_TENANT_ID, runId],
    );
    if (pendingApproval) return;

    if (Date.now() >= deadline) {
      throw new Error(
        `execution run '${runId}' did not resume/cancel within ${String(timeoutMs)}ms`,
      );
    }

    await sleep(25);
  }
}

async function envelopeForRunStatus(
  db: SqlDb,
  runId: string,
  timeoutMs: number,
): Promise<PlaybookRuntimeEnvelopeT> {
  let row: { status: string; paused_reason: string | null; paused_detail: string | null };
  try {
    row = await waitForRunToSettle(db, runId, timeoutMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = message.includes("did not settle")
      ? "timeout"
      : message.includes("not found")
        ? "not_found"
        : "internal";
    return { ok: false, status: "error", output: [], error: { message, code } };
  }

  if (row.status === "succeeded") {
    return { ok: true, status: "ok", output: [] };
  }

  if (row.status === "cancelled") {
    return { ok: true, status: "cancelled", output: [] };
  }

  if (row.status === "paused") {
    const approval = await loadPendingApprovalForRun(db, runId);
    if (!approval) {
      return {
        ok: false,
        status: "error",
        output: [],
        error: { message: `run '${runId}' is paused but no pending approval was found` },
      };
    }
    return {
      ok: true,
      status: "needs_approval",
      output: [],
      requiresApproval: {
        prompt: approval.prompt,
        items: [],
        resumeToken: approval.resumeToken,
      },
    };
  }

  const errorMessage =
    (await loadRunErrorMessage(db, runId)) ||
    row.paused_detail?.trim() ||
    row.paused_reason?.trim() ||
    `execution run '${runId}' failed`;

  return { ok: false, status: "error", output: [], error: { message: errorMessage } };
}

export interface PlaybookRuntimeDeps {
  db: SqlDb;
  engine: ExecutionEngine;
  policyService: PolicyService;
  approvalDal: ApprovalDal;
  playbooks: Playbook[];
  runner: PlaybookRunner;
}

type PlaybookRunInput = {
  action: "run";
  pipeline: string;
  argsJson?: string;
  cwd?: string;
  maxOutputBytes?: number;
  timeoutMs?: number;
};

type PlaybookResumeInput = {
  action: "resume";
  token: string;
  approve: boolean;
  reason?: string;
  timeoutMs?: number;
};

type PlaybookRuntimeInput = PlaybookRunInput | PlaybookResumeInput;

type PlaybookStep = ReturnType<PlaybookRunner["run"]>["steps"][number];

function parseRuntimeArgs(argsJson: string | undefined): {
  runtimeArgs: unknown | undefined;
  error?: PlaybookRuntimeEnvelopeT;
} {
  if (argsJson === undefined) {
    return { runtimeArgs: undefined };
  }

  try {
    return { runtimeArgs: JSON.parse(argsJson) as unknown };
  } catch (err) {
    void err;
    return {
      runtimeArgs: undefined,
      error: {
        ok: false,
        status: "error",
        output: [],
        error: { message: "argsJson must be valid JSON", code: "invalid_request" },
      },
    };
  }
}

function validateWorkspaceRelativeCwd(
  cwd: string | undefined,
): PlaybookRuntimeEnvelopeT | undefined {
  if (!cwd) return undefined;

  const trimmed = cwd.trim();
  if (trimmed.length === 0 || isAbsolute(trimmed) || trimmed.split(/[\\/]+/).includes("..")) {
    return {
      ok: false,
      status: "error",
      output: [],
      error: { message: "cwd must be a workspace-relative path", code: "invalid_request" },
    };
  }

  return undefined;
}

function applyRuntimeStepOverrides(
  steps: readonly PlaybookStep[],
  input: PlaybookRunInput,
  runtimeArgs: unknown | undefined,
): PlaybookStep[] {
  return steps.map((step) => {
    if (!input.cwd && input.maxOutputBytes === undefined && runtimeArgs === undefined) {
      return step;
    }

    const nextArgs: Record<string, unknown> = { ...step.args };
    if (runtimeArgs !== undefined) {
      nextArgs["__playbook_runtime_args"] = runtimeArgs;
    }
    if (input.cwd) {
      nextArgs["cwd"] = input.cwd;
    }
    if (typeof input.maxOutputBytes === "number" && Number.isFinite(input.maxOutputBytes)) {
      nextArgs["max_output_bytes"] = Math.floor(input.maxOutputBytes);
    }

    return Object.assign({}, step, { args: nextArgs });
  });
}

function buildTriggerMetadata(
  playbook: Playbook,
  input: PlaybookRunInput,
  runtimeArgs: unknown | undefined,
): Record<string, unknown> {
  const triggerMetadata: Record<string, unknown> = {
    source: "playbook-runtime",
    playbook_id: playbook.manifest.id,
  };
  if (runtimeArgs !== undefined) {
    triggerMetadata["args"] = runtimeArgs;
  }
  if (input.cwd) {
    triggerMetadata["cwd"] = input.cwd;
  }
  if (typeof input.maxOutputBytes === "number" && Number.isFinite(input.maxOutputBytes)) {
    triggerMetadata["max_output_bytes"] = Math.floor(input.maxOutputBytes);
  }
  return triggerMetadata;
}

async function runPlaybookRuntimeAction(
  deps: PlaybookRuntimeDeps,
  input: PlaybookRunInput,
  timeoutMs: number,
): Promise<PlaybookRuntimeEnvelopeT> {
  const parsedArgs = parseRuntimeArgs(input.argsJson);
  if (parsedArgs.error) {
    return parsedArgs.error;
  }

  const cwdError = validateWorkspaceRelativeCwd(input.cwd);
  if (cwdError) {
    return cwdError;
  }

  const playbook = resolvePlaybookFromPipeline(input.pipeline, deps.playbooks);
  const compiled = deps.runner.run(playbook);
  const steps = applyRuntimeStepOverrides(compiled.steps, input, parsedArgs.runtimeArgs);
  const planId = `playbook-${playbook.manifest.id}-${randomUUID()}`;
  const requestId = `req-${randomUUID()}`;
  const key = `playbook:${playbook.manifest.id}`;
  const lane = "main";

  const playbookBundle = resolvePlaybookPolicyBundle(playbook);
  const effectivePolicy = await deps.policyService.loadEffectiveBundle({
    tenantId: DEFAULT_TENANT_ID,
    playbookBundle,
  });
  const snapshot = await deps.policyService.getOrCreateSnapshot(
    DEFAULT_TENANT_ID,
    effectivePolicy.bundle,
  );

  const res = await deps.engine.enqueuePlan({
    tenantId: DEFAULT_TENANT_ID,
    key,
    lane,
    planId,
    requestId,
    steps,
    policySnapshotId: snapshot.policy_snapshot_id,
    trigger: {
      kind: "api",
      conversation_key: key,
      metadata: buildTriggerMetadata(playbook, input, parsedArgs.runtimeArgs),
    },
  });

  return envelopeForRunStatus(deps.db, res.runId, timeoutMs);
}

function resolveApprovalRunId(row: ApprovalRow): string | undefined {
  const id = row.run_id?.trim();
  return id && id.length > 0 ? id : undefined;
}

async function runPlaybookResumeAction(
  deps: PlaybookRuntimeDeps,
  input: PlaybookResumeInput,
  timeoutMs: number,
): Promise<PlaybookRuntimeEnvelopeT> {
  const approval = await deps.approvalDal.getByResumeToken({
    tenantId: DEFAULT_TENANT_ID,
    resumeToken: input.token,
  });
  if (!approval) {
    return {
      ok: false,
      status: "error",
      output: [],
      error: { message: "resume token not found", code: "not_found" },
    };
  }

  const runId = resolveApprovalRunId(approval);
  if (!runId) {
    return {
      ok: false,
      status: "error",
      output: [],
      error: { message: "approval is missing run_id", code: "invalid_state" },
    };
  }

  const resolvedApproval =
    approval.status === "awaiting_human"
      ? (
          await deps.approvalDal.resolveWithEngineAction({
            tenantId: DEFAULT_TENANT_ID,
            approvalId: approval.approval_id,
            decision: input.approve ? "approved" : "denied",
            reason: input.reason,
            resolvedBy: { kind: "playbook" },
          })
        )?.approval
      : approval;
  if (!resolvedApproval) {
    return {
      ok: false,
      status: "error",
      output: [],
      error: { message: "resume token not found", code: "not_found" },
    };
  }

  const matches =
    (input.approve && resolvedApproval.status === "approved") ||
    (!input.approve && resolvedApproval.status === "denied");
  if (!matches) {
    return {
      ok: false,
      status: "error",
      output: [],
      error: { message: "approval already resolved", code: "conflict" },
    };
  }

  const deadline = Date.now() + Math.max(1, timeoutMs);
  const remainingTimeoutMs = () => Math.max(1, deadline - Date.now());

  try {
    await waitForRunToResumeOrCancel(deps.db, runId, remainingTimeoutMs());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: "error",
      output: [],
      error: { message, code: "timeout" },
    };
  }

  return envelopeForRunStatus(deps.db, runId, remainingTimeoutMs());
}

export async function runPlaybookRuntimeEnvelope(
  deps: PlaybookRuntimeDeps,
  input: PlaybookRuntimeInput,
): Promise<PlaybookRuntimeEnvelopeT> {
  const timeoutMs = input.timeoutMs ?? 30_000;

  try {
    if (input.action === "run") {
      return await runPlaybookRuntimeAction(deps, input, timeoutMs);
    }
    return await runPlaybookResumeAction(deps, input, timeoutMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      isValidationError(err) || message.includes("not loaded") ? "invalid_request" : "internal";
    return {
      ok: false,
      status: "error",
      output: [],
      error: { message, code },
    };
  }
}
