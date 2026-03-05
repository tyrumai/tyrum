import type { Playbook, PlaybookRuntimeEnvelope as PlaybookRuntimeEnvelopeT } from "@tyrum/schemas";
import { PlaybookManifest, PolicyBundle } from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ExecutionEngine } from "../execution/engine.js";
import type { PolicyService } from "../policy/service.js";
import type { ApprovalDal, ApprovalRow } from "../approval/dal.js";
import type { SqlDb } from "../../statestore/types.js";
import type { PlaybookRunner } from "./runner.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
     WHERE tenant_id = ? AND run_id = ? AND status = 'pending'
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
     WHERE s.run_id = ? AND a.error IS NOT NULL
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
    }>("SELECT status, paused_reason, paused_detail FROM execution_runs WHERE run_id = ?", [runId]);
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
    const row = await db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    if (!row) {
      throw new Error(`execution run '${runId}' not found`);
    }

    if (row.status !== "paused") return;

    const pendingApproval = await db.get<{ n: number }>(
      `SELECT 1 AS n
       FROM approvals
       WHERE tenant_id = ?
         AND run_id = ?
         AND status = 'pending'
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

export async function runPlaybookRuntimeEnvelope(
  deps: PlaybookRuntimeDeps,
  input:
    | {
        action: "run";
        pipeline: string;
        argsJson?: string;
        cwd?: string;
        maxOutputBytes?: number;
        timeoutMs?: number;
      }
    | { action: "resume"; token: string; approve: boolean; reason?: string; timeoutMs?: number },
): Promise<PlaybookRuntimeEnvelopeT> {
  const timeoutMs = input.timeoutMs ?? 30_000;

  try {
    if (input.action === "run") {
      let runtimeArgs: unknown | undefined;
      if (input.argsJson !== undefined) {
        try {
          runtimeArgs = JSON.parse(input.argsJson) as unknown;
        } catch {
          // Intentional: surface invalid JSON as a structured invalid_request error.
          return {
            ok: false,
            status: "error",
            output: [],
            error: { message: "argsJson must be valid JSON", code: "invalid_request" },
          };
        }
      }

      if (input.cwd) {
        const trimmed = input.cwd.trim();
        if (trimmed.length === 0 || isAbsolute(trimmed) || trimmed.split(/[\\/]+/).includes("..")) {
          return {
            ok: false,
            status: "error",
            output: [],
            error: { message: "cwd must be a workspace-relative path", code: "invalid_request" },
          };
        }
      }

      const playbook = resolvePlaybookFromPipeline(input.pipeline, deps.playbooks);
      const compiled = deps.runner.run(playbook);
      const steps = compiled.steps.map((step) => {
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

        return { ...step, args: nextArgs };
      });

      const planId = `playbook-${playbook.manifest.id}-${randomUUID()}`;
      const requestId = `req-${randomUUID()}`;
      const key = `playbook:${playbook.manifest.id}`;
      const lane = "main";

      const playbookBundle = resolvePlaybookPolicyBundle(playbook);
      const effectivePolicy = await deps.policyService.loadEffectiveBundle({ playbookBundle });
      const snapshot = await deps.policyService.getOrCreateSnapshot(
        DEFAULT_TENANT_ID,
        effectivePolicy.bundle,
      );

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

      const res = await deps.engine.enqueuePlan({
        tenantId: DEFAULT_TENANT_ID,
        key,
        lane,
        planId,
        requestId,
        steps,
        policySnapshotId: snapshot.policy_snapshot_id,
        trigger: { kind: "api", key, lane, metadata: triggerMetadata },
      });

      return await envelopeForRunStatus(deps.db, res.runId, timeoutMs);
    }

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

    const resolveRunId = (row: ApprovalRow): string | undefined => {
      const id = row.run_id?.trim();
      return id && id.length > 0 ? id : undefined;
    };

    const runId = resolveRunId(approval);
    if (!runId) {
      return {
        ok: false,
        status: "error",
        output: [],
        error: { message: "approval is missing run_id", code: "invalid_state" },
      };
    }

    const resolvedApproval =
      approval.status === "pending"
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

    try {
      await waitForRunToResumeOrCancel(deps.db, runId, timeoutMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        status: "error",
        output: [],
        error: { message, code: "timeout" },
      };
    }

    return await envelopeForRunStatus(deps.db, runId, timeoutMs);
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
