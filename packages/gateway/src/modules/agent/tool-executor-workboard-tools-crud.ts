import { WorkboardDal } from "../workboard/dal.js";
import type { ToolExecutionAudit, ToolResult } from "./tool-executor-shared.js";
import {
  asRecord,
  extractSubagentIdFromSessionKey,
  jsonResult,
  readNumber,
  readString,
  readStringArray,
  requireDb,
  requireWorkScope,
  type WorkboardToolExecutorContext,
} from "./tool-executor-workboard-tools-shared.js";

function readStateScope(
  scope: ReturnType<typeof requireWorkScope>,
  record: Record<string, unknown> | null,
):
  | { kind: "agent"; tenant_id: string; agent_id: string; workspace_id: string }
  | {
      kind: "work_item";
      tenant_id: string;
      agent_id: string;
      workspace_id: string;
      work_item_id: string;
    } {
  const scopeKind = readString(record, "scope_kind");
  const workItemId = readString(record, "work_item_id");
  if (scopeKind === "work_item" || workItemId) {
    if (!workItemId) {
      throw new Error("work_item_id is required for work_item state scope");
    }
    return { kind: "work_item", ...scope, work_item_id: workItemId };
  }
  return { kind: "agent", ...scope };
}

export async function executeWorkboardCrudTool(params: {
  context: WorkboardToolExecutorContext;
  toolId: string;
  toolCallId: string;
  args: unknown;
  audit?: ToolExecutionAudit;
}): Promise<ToolResult | undefined> {
  const db = requireDb(params.context);
  const scope = requireWorkScope(params.context);
  const workboard = new WorkboardDal(db);
  const record = asRecord(params.args);

  switch (params.toolId) {
    case "workboard.item.list":
      return jsonResult(params.toolCallId, {
        ...(await workboard.listItems({
          scope,
          statuses: readStringArray(record, "statuses") as
            | ("backlog" | "ready" | "doing" | "blocked" | "done" | "failed" | "cancelled")[]
            | undefined,
          kinds: readStringArray(record, "kinds") as ("action" | "initiative")[] | undefined,
          limit: readNumber(record, "limit"),
          cursor: readString(record, "cursor"),
        })),
      });
    case "workboard.item.get":
      return jsonResult(params.toolCallId, {
        item: await workboard.getItem({
          scope,
          work_item_id: readString(record, "work_item_id") ?? "",
        }),
      });
    case "workboard.item.delete":
      return jsonResult(params.toolCallId, {
        item: await workboard.deleteItem({
          scope,
          work_item_id: readString(record, "work_item_id") ?? "",
        }),
      });
    case "workboard.item.create":
      return jsonResult(params.toolCallId, {
        item: await workboard.createItem({
          scope,
          createdFromSessionKey: params.audit?.work_session_key,
          item: {
            kind: readString(record, "kind") === "initiative" ? "initiative" : "action",
            title: readString(record, "title") ?? "Work item",
            priority: Math.max(0, Math.floor(readNumber(record, "priority") ?? 0)),
            acceptance: record?.["acceptance"],
            parent_work_item_id: readString(record, "parent_work_item_id"),
          },
        }),
      });
    case "workboard.item.update":
      return jsonResult(params.toolCallId, {
        item: await workboard.updateItem({
          scope,
          work_item_id: readString(record, "work_item_id") ?? "",
          patch: {
            ...(readString(record, "title") ? { title: readString(record, "title") } : {}),
            ...(readNumber(record, "priority") !== undefined
              ? { priority: Math.max(0, Math.floor(readNumber(record, "priority") ?? 0)) }
              : {}),
            ...(record?.["acceptance"] !== undefined ? { acceptance: record["acceptance"] } : {}),
          },
        }),
      });
    case "workboard.item.transition":
      if (readString(record, "status") === "doing") {
        throw new Error(
          "manual transition to doing is not allowed; execution dispatch is automatic",
        );
      }
      return jsonResult(params.toolCallId, {
        item: await workboard.transitionItem({
          scope,
          work_item_id: readString(record, "work_item_id") ?? "",
          status: (readString(record, "status") ?? "backlog") as
            | "backlog"
            | "ready"
            | "doing"
            | "blocked"
            | "done"
            | "failed"
            | "cancelled",
          reason: readString(record, "reason"),
        }),
      });
    case "workboard.task.list":
      return jsonResult(params.toolCallId, {
        tasks: await workboard.listTasks({
          scope,
          work_item_id: readString(record, "work_item_id") ?? "",
        }),
      });
    case "workboard.task.get":
      return jsonResult(params.toolCallId, {
        task: await workboard.getTask({
          scope,
          task_id: readString(record, "task_id") ?? "",
        }),
      });
    case "workboard.task.delete":
      return jsonResult(params.toolCallId, {
        task: await workboard.deleteTask({
          scope,
          task_id: readString(record, "task_id") ?? "",
        }),
      });
    case "workboard.task.create":
      return jsonResult(params.toolCallId, {
        task: await workboard.createTask({
          scope,
          task: {
            work_item_id: readString(record, "work_item_id") ?? "",
            status: (readString(record, "status") ?? "queued") as
              | "queued"
              | "leased"
              | "running"
              | "paused"
              | "completed"
              | "failed"
              | "cancelled"
              | "skipped",
            depends_on: readStringArray(record, "depends_on"),
            execution_profile: readString(record, "execution_profile") ?? "planner",
            side_effect_class: readString(record, "side_effect_class") ?? "workspace",
            result_summary: readString(record, "result_summary"),
          },
        }),
      });
    case "workboard.task.update":
      return jsonResult(params.toolCallId, {
        task: await workboard.updateTask({
          scope,
          task_id: readString(record, "task_id") ?? "",
          patch: {
            ...(readString(record, "status")
              ? {
                  status: readString(record, "status") as
                    | "queued"
                    | "leased"
                    | "running"
                    | "paused"
                    | "completed"
                    | "failed"
                    | "cancelled"
                    | "skipped",
                }
              : {}),
            ...(readString(record, "result_summary")
              ? { result_summary: readString(record, "result_summary") }
              : {}),
          },
        }),
      });
    case "workboard.artifact.list":
      return jsonResult(
        params.toolCallId,
        await workboard.listArtifacts({
          scope,
          work_item_id: readString(record, "work_item_id"),
          limit: readNumber(record, "limit"),
          cursor: readString(record, "cursor"),
        }),
      );
    case "workboard.artifact.get":
      return jsonResult(params.toolCallId, {
        artifact: await workboard.getArtifact({
          scope,
          artifact_id: readString(record, "artifact_id") ?? "",
        }),
      });
    case "workboard.artifact.delete":
      return jsonResult(params.toolCallId, {
        artifact: await workboard.deleteArtifact({
          scope,
          artifact_id: readString(record, "artifact_id") ?? "",
        }),
      });
    case "workboard.artifact.create":
      return jsonResult(params.toolCallId, {
        artifact: await workboard.createArtifact({
          scope,
          artifact: {
            work_item_id: readString(record, "work_item_id"),
            kind: (readString(record, "kind") ?? "other") as
              | "candidate_plan"
              | "hypothesis"
              | "risk"
              | "tool_intent"
              | "verification_report"
              | "jury_opinion"
              | "result_summary"
              | "other",
            title: readString(record, "title") ?? "Artifact",
            body_md: readString(record, "body_md"),
            refs: readStringArray(record, "refs"),
            created_by_subagent_id: extractSubagentIdFromSessionKey(params.audit?.work_session_key),
          },
        }),
      });
    case "workboard.decision.list":
      return jsonResult(
        params.toolCallId,
        await workboard.listDecisions({
          scope,
          work_item_id: readString(record, "work_item_id"),
          limit: readNumber(record, "limit"),
          cursor: readString(record, "cursor"),
        }),
      );
    case "workboard.decision.get":
      return jsonResult(params.toolCallId, {
        decision: await workboard.getDecision({
          scope,
          decision_id: readString(record, "decision_id") ?? "",
        }),
      });
    case "workboard.decision.delete":
      return jsonResult(params.toolCallId, {
        decision: await workboard.deleteDecision({
          scope,
          decision_id: readString(record, "decision_id") ?? "",
        }),
      });
    case "workboard.decision.create":
      if (!readString(record, "chosen") || !readString(record, "rationale_md")) {
        throw new Error("chosen and rationale_md are required");
      }
      return jsonResult(params.toolCallId, {
        decision: await workboard.createDecision({
          scope,
          decision: {
            work_item_id: readString(record, "work_item_id"),
            question: readString(record, "question") ?? "Decision",
            chosen: readString(record, "chosen") ?? "Decision",
            rationale_md: readString(record, "rationale_md") ?? "No rationale provided.",
            alternatives: readStringArray(record, "alternatives"),
            input_artifact_ids: readStringArray(record, "input_artifact_ids"),
            created_by_subagent_id: extractSubagentIdFromSessionKey(params.audit?.work_session_key),
          },
        }),
      });
    case "workboard.signal.list":
      return jsonResult(
        params.toolCallId,
        await workboard.listSignals({
          scope,
          work_item_id: readString(record, "work_item_id"),
          statuses: readStringArray(record, "statuses") as
            | ("active" | "paused" | "fired" | "resolved" | "cancelled")[]
            | undefined,
          limit: readNumber(record, "limit"),
          cursor: readString(record, "cursor"),
        }),
      );
    case "workboard.signal.get":
      return jsonResult(params.toolCallId, {
        signal: await workboard.getSignal({
          scope,
          signal_id: readString(record, "signal_id") ?? "",
        }),
      });
    case "workboard.signal.delete":
      return jsonResult(params.toolCallId, {
        signal: await workboard.deleteSignal({
          scope,
          signal_id: readString(record, "signal_id") ?? "",
        }),
      });
    case "workboard.signal.create":
      return jsonResult(params.toolCallId, {
        signal: await workboard.createSignal({
          scope,
          signal: {
            work_item_id: readString(record, "work_item_id"),
            trigger_kind: (readString(record, "trigger_kind") ?? "event") as "time" | "event",
            trigger_spec_json: record?.["trigger_spec_json"] ?? null,
            payload_json: record?.["payload_json"],
            status: readString(record, "status") as
              | "active"
              | "paused"
              | "fired"
              | "resolved"
              | "cancelled"
              | undefined,
          },
        }),
      });
    case "workboard.signal.update":
      return jsonResult(params.toolCallId, {
        updated: await workboard.updateSignal({
          scope,
          signal_id: readString(record, "signal_id") ?? "",
          patch: {
            ...(record?.["trigger_spec_json"] !== undefined
              ? { trigger_spec_json: record["trigger_spec_json"] }
              : {}),
            ...(record?.["payload_json"] !== undefined
              ? { payload_json: record["payload_json"] }
              : {}),
            ...(readString(record, "status")
              ? {
                  status: readString(record, "status") as
                    | "active"
                    | "paused"
                    | "fired"
                    | "resolved"
                    | "cancelled",
                }
              : {}),
          },
        }),
      });
    case "workboard.state.list":
      return jsonResult(
        params.toolCallId,
        await workboard.listStateKv({
          scope: readStateScope(scope, record),
          prefix: readString(record, "prefix"),
        }),
      );
    case "workboard.state.get":
      return jsonResult(params.toolCallId, {
        entry: await workboard.getStateKv({
          scope: readStateScope(scope, record),
          key: readString(record, "key") ?? "",
        }),
      });
    case "workboard.state.delete":
      return jsonResult(params.toolCallId, {
        entry: await workboard.deleteStateKv({
          scope: readStateScope(scope, record),
          key: readString(record, "key") ?? "",
        }),
      });
    case "workboard.state.set":
      return jsonResult(params.toolCallId, {
        entry: await workboard.setStateKv({
          scope: readStateScope(scope, record),
          key: readString(record, "key") ?? "",
          value_json: record?.["value_json"] ?? null,
          provenance_json: record?.["provenance_json"],
        }),
      });
    default:
      return undefined;
  }
}
