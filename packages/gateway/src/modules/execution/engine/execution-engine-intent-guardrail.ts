import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/contracts";
import { requiresPostcondition } from "@tyrum/contracts";
import type { Logger } from "../../observability/logger.js";
import type { SqlDb } from "../../../statestore/types.js";
import { WorkboardDal } from "../../workboard/dal.js";
import { sha256HexFromString, stableJsonStringify } from "@tyrum/runtime-policy";
import type {
  ExecutionApprovalPort,
  ExecutionClock,
  ExecutionPauseRunForApprovalOptions,
} from "./types.js";
import { normalizePositiveInt } from "../normalize-positive-int.js";
import { parsePlanIdFromTriggerJson } from "./db.js";
import {
  isRecord,
  normalizeNonnegativeInt,
  parseTriggerMetadata,
  type RunnableTurnRow,
  type StepRow,
} from "./shared.js";

export interface IntentGuardrailDeps {
  logger?: Logger;
  approvalManager: ExecutionApprovalPort<SqlDb>;
}

function resolveToolIntentError(
  toolIntent: { provenance_json?: unknown; artifact_id: string } | undefined,
  intentGraphSha256: string,
): string | undefined {
  if (!toolIntent) return "missing ToolIntent (kind=tool_intent) for this step";
  const prov = toolIntent.provenance_json;
  if (!isRecord(prov)) return "ToolIntent provenance_json must be an object";

  const goal = typeof prov["goal"] === "string" ? prov["goal"].trim() : "";
  const expectedValue =
    typeof prov["expected_value"] === "string" ? prov["expected_value"].trim() : "";
  const sideEffectClass =
    typeof prov["side_effect_class"] === "string" ? prov["side_effect_class"].trim() : "";
  const riskClass = typeof prov["risk_class"] === "string" ? prov["risk_class"].trim() : "";
  const expectedEvidence = prov["expected_evidence"];
  const budget = prov["cost_budget"];
  const budgetOk =
    isRecord(budget) &&
    (normalizeNonnegativeInt(budget["max_usd_micros"]) !== undefined ||
      normalizePositiveInt(budget["max_duration_ms"]) !== undefined ||
      normalizeNonnegativeInt(budget["max_total_tokens"]) !== undefined);
  const claimedSha =
    typeof prov["intent_graph_sha256"] === "string" ? prov["intent_graph_sha256"].trim() : "";

  if (!goal) return "ToolIntent.goal is required";
  if (!expectedValue) return "ToolIntent.expected_value is required";
  if (!budgetOk) return "ToolIntent.cost_budget is required";
  if (!sideEffectClass) return "ToolIntent.side_effect_class is required";
  if (!riskClass) return "ToolIntent.risk_class is required";
  if (expectedEvidence === undefined) return "ToolIntent.expected_evidence is required";
  if (!claimedSha) return "ToolIntent.intent_graph_sha256 is required";
  if (claimedSha !== intentGraphSha256) {
    return "ToolIntent intent_graph_sha256 does not match current intent graph";
  }
  return undefined;
}

async function writeGuardrailEvidence(
  deps: IntentGuardrailDeps,
  tx: SqlDb,
  dal: WorkboardDal,
  opts: {
    run: RunnableTurnRow;
    step: StepRow;
    actionType: ActionPrimitiveT["type"];
    clock: ExecutionClock;
  },
  workItemId: string,
  intentGraphSha256: string,
  toolIntentArtifactId: string | undefined,
  error: string,
): Promise<{ artifactId: string | undefined; decisionId: string | undefined }> {
  const scope = {
    tenant_id: opts.run.tenant_id,
    agent_id: opts.run.agent_id,
    workspace_id: opts.run.workspace_id,
  } as const;

  let artifactId: string | undefined;
  let decisionId: string | undefined;
  const evidenceSavepoint = `tyrum_intent_guardrail_evidence_${String(opts.step.step_index)}`;
  let evidenceSavepointCreated = false;
  try {
    await tx.exec(`SAVEPOINT ${evidenceSavepoint}`);
    evidenceSavepointCreated = true;

    const reportLines = [
      "Blocked side-effecting step due to ToolIntent deviation.",
      "",
      `- turn_id: \`${opts.run.turn_id}\``,
      `- step_index: \`${String(opts.step.step_index)}\``,
      `- action_type: \`${opts.actionType}\``,
      `- reason: ${error}`,
      `- intent_graph_sha256: \`${intentGraphSha256}\``,
      toolIntentArtifactId ? `- tool_intent_artifact_id: \`${toolIntentArtifactId}\`` : undefined,
    ];
    const report = await dal.createArtifact({
      scope,
      artifact: {
        work_item_id: workItemId,
        kind: "verification_report",
        title: "Intent guardrail: pause before side effect",
        body_md: reportLines.filter((line): line is string => Boolean(line)).join("\n"),
        refs: [`run:${opts.run.turn_id}`, `step:${String(opts.step.step_index)}`],
        created_by_turn_id: opts.run.turn_id,
        provenance_json: {
          v: 1,
          kind: "intent_guardrail",
          reason: error,
          intent_graph_sha256: intentGraphSha256,
          turn_id: opts.run.turn_id,
          step_index: opts.step.step_index,
          action_type: opts.actionType,
          tool_intent_artifact_id: toolIntentArtifactId,
        },
      },
      createdAtIso: opts.clock.nowIso,
    });
    artifactId = report.artifact_id;

    const rationaleLines = [
      "Pausing execution before a side-effecting step because ToolIntent validation failed.",
      "",
      `Reason: ${error}`,
      "",
      `Expected intent graph hash: \`${intentGraphSha256}\``,
      artifactId ? `Evidence artifact: \`${artifactId}\`` : undefined,
    ];
    const decision = await dal.createDecision({
      scope,
      decision: {
        work_item_id: workItemId,
        question: `Proceed with side-effecting step ${String(opts.step.step_index)}?`,
        chosen: "pause_and_escalate",
        alternatives: ["proceed_without_tool_intent", "cancel_step_or_run"],
        rationale_md: rationaleLines.filter((line): line is string => Boolean(line)).join("\n"),
        input_artifact_ids: artifactId ? [artifactId] : [],
        created_by_turn_id: opts.run.turn_id,
      },
      createdAtIso: opts.clock.nowIso,
    });
    decisionId = decision.decision_id;

    await tx.exec(`RELEASE SAVEPOINT ${evidenceSavepoint}`);
  } catch (err) {
    if (evidenceSavepointCreated) {
      try {
        await tx.exec(`ROLLBACK TO SAVEPOINT ${evidenceSavepoint}`);
        await tx.exec(`RELEASE SAVEPOINT ${evidenceSavepoint}`);
      } catch (rollbackErr) {
        const rollbackMessage =
          rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
        deps.logger?.warn("intent_guardrail.evidence_rollback_failed", {
          turn_id: opts.run.turn_id,
          step_id: opts.step.step_id,
          error: rollbackMessage,
        });
      }
    }

    artifactId = undefined;
    decisionId = undefined;
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.warn("intent_guardrail.evidence_write_failed", {
      turn_id: opts.run.turn_id,
      step_id: opts.step.step_id,
      error: message,
    });
  }

  return { artifactId, decisionId };
}

export async function maybePauseForToolIntentGuardrailTx(
  deps: IntentGuardrailDeps,
  tx: SqlDb,
  opts: {
    run: RunnableTurnRow;
    step: StepRow;
    actionType: ActionPrimitiveT["type"] | undefined;
    action: ActionPrimitiveT | undefined;
    clock: ExecutionClock;
    workerId: string;
  },
): Promise<{ approvalId: string } | undefined> {
  if (!opts.actionType) return undefined;
  if (!requiresPostcondition(opts.actionType)) return undefined;

  const metadata = parseTriggerMetadata(opts.run.trigger_json);
  const workItemIdRaw = metadata?.["work_item_id"];
  const workItemId = typeof workItemIdRaw === "string" ? workItemIdRaw.trim() : "";
  if (workItemId.length === 0) return undefined;

  const existingApproval = await tx.get<{ n: number }>(
    `SELECT 1 AS n FROM approvals WHERE tenant_id = ? AND turn_id = ? AND step_id = ? AND kind = 'intent' AND status = 'approved' LIMIT 1`,
    [opts.run.tenant_id, opts.run.turn_id, opts.step.step_id],
  );
  if (existingApproval) return undefined;

  const scope = {
    tenant_id: opts.run.tenant_id,
    agent_id: opts.run.agent_id,
    workspace_id: opts.run.workspace_id,
  } as const;

  const dal = new WorkboardDal(tx);
  const planId = parsePlanIdFromTriggerJson(opts.run.trigger_json) ?? opts.run.turn_id;

  const pauseOpts: ExecutionPauseRunForApprovalOptions = {
    tenantId: opts.run.tenant_id,
    agentId: opts.run.agent_id,
    workspaceId: opts.run.workspace_id,
    planId,
    stepIndex: opts.step.step_index,
    turnId: opts.run.turn_id,
    stepId: opts.step.step_id,
    jobId: opts.run.job_id,
    key: opts.run.key,
    workerId: opts.workerId,
  };

  const item = await dal.getItem({ scope, work_item_id: workItemId });
  if (!item) {
    const paused = await deps.approvalManager.pauseRunForApproval(tx, pauseOpts, {
      kind: "intent",
      prompt: "Intent guardrail — work item not found",
      detail: `work_item_id=${workItemId} not found in scope; pausing before side-effecting step execution`,
      context: {
        work_item_id: workItemId,
        action_type: opts.actionType,
        step_index: opts.step.step_index,
      },
    });
    return { approvalId: paused.approvalId };
  }

  const { entries } = await dal.listStateKv({
    scope: { ...scope, kind: "work_item", work_item_id: workItemId },
  });
  const stateKv: Record<string, unknown> = {};
  for (const entry of entries) {
    if (isRecord(entry) && typeof entry["key"] === "string") {
      stateKv[entry["key"]] = entry["value_json"];
    }
  }

  const { decisions } = await dal.listDecisions({ scope, work_item_id: workItemId, limit: 50 });
  const decisionIds = decisions
    .map((d) => d.decision_id)
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const intentGraphSha256 = sha256HexFromString(
    stableJsonStringify({
      v: 1,
      work_item_id: workItemId,
      acceptance: item.acceptance ?? null,
      state_kv: stateKv,
      decision_ids: decisionIds,
      policy_snapshot_id: opts.run.policy_snapshot_id ?? null,
    }),
  );

  const { artifacts } = await dal.listArtifacts({ scope, work_item_id: workItemId, limit: 200 });
  const toolIntent = artifacts
    .filter((a) => a.kind === "tool_intent")
    .find((a) => {
      const prov = a.provenance_json;
      if (!isRecord(prov)) return false;
      return prov["turn_id"] === opts.run.turn_id && prov["step_index"] === opts.step.step_index;
    });

  const error = resolveToolIntentError(toolIntent, intentGraphSha256);
  if (!error) return undefined;

  const { artifactId, decisionId } = await writeGuardrailEvidence(
    deps,
    tx,
    dal,
    opts as typeof opts & { actionType: ActionPrimitiveT["type"] },
    workItemId,
    intentGraphSha256,
    toolIntent?.artifact_id,
    error,
  );

  const paused = await deps.approvalManager.pauseRunForApproval(tx, pauseOpts, {
    kind: "intent",
    prompt: "Intent guardrail — ToolIntent required",
    detail: error,
    context: {
      work_item_id: workItemId,
      action_type: opts.actionType,
      step_index: opts.step.step_index,
      intent_graph_sha256: intentGraphSha256,
      tool_intent_artifact_id: toolIntent?.artifact_id,
      work_artifact_id: artifactId,
      decision_id: decisionId,
    },
  });
  return { approvalId: paused.approvalId };
}
