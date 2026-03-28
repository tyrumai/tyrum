import { ConversationQueueSignalDal } from "../conversation-queue/queue-signal-dal.js";
import { WorkboardDal } from "../workboard/dal.js";
import { createGatewayWorkboardService } from "../workboard/service.js";
import { SubagentService } from "../workboard/subagent-service.js";
import { requireHelperExecutionProfile } from "./subagent-helper-profiles.js";
import { readWorkConversationKey } from "./tool-execution-conversation.js";
import type { ToolExecutionAudit, ToolResult } from "./tool-executor-shared.js";
import { executeWorkboardCrudTool } from "./tool-executor-workboard-tools-crud.js";
import {
  asRecord,
  extractSubagentIdFromConversationKey,
  jsonResult,
  readNumber,
  readString,
  readStringArray,
  requireDb,
  requireWorkScope,
  resolveClarificationTargetConversationKey,
  type WorkboardToolExecutorContext,
} from "./tool-executor-workboard-tools-shared.js";

async function createCapture(
  context: WorkboardToolExecutorContext,
  toolCallId: string,
  args: unknown,
  audit?: ToolExecutionAudit,
): Promise<ToolResult> {
  const db = requireDb(context);
  const scope = requireWorkScope(context);
  const record = asRecord(args);
  const createdFromConversationKey = readWorkConversationKey(audit);
  if (!createdFromConversationKey) {
    throw new Error("workboard.capture requires an active work conversation");
  }

  const workboardService = createGatewayWorkboardService({ db });
  const item = await workboardService.createItem({
    scope,
    item: {
      kind: readString(record, "kind") === "initiative" ? "initiative" : "action",
      title: readString(record, "title") ?? "Captured work item",
      priority: Math.max(0, Math.floor(readNumber(record, "priority") ?? 0)),
      acceptance:
        record?.["acceptance"] ??
        (readString(record, "request") ? { request: readString(record, "request") } : undefined),
      parent_work_item_id: readString(record, "parent_work_item_id"),
    },
    createdFromConversationKey,
    captureEvent: {
      kind: "work.capture",
      payload_json: {
        request: readString(record, "request") ?? null,
        source_conversation_key: createdFromConversationKey,
      },
    },
  });

  return jsonResult(toolCallId, {
    work_item_id: item.work_item_id,
    status: item.status,
    refinement_phase: "new",
  });
}

async function executeSubagentSpawnOrSend(
  context: WorkboardToolExecutorContext,
  toolCallId: string,
  toolId: string,
  args: unknown,
  audit?: ToolExecutionAudit,
): Promise<ToolResult> {
  const agents = context.agents;
  if (!agents) {
    throw new Error(`${toolId} requires agent runtime access`);
  }
  const db = requireDb(context);
  const scope = requireWorkScope(context);
  const subagents = new SubagentService({ db, agents });
  const record = asRecord(args);
  const message = readString(record, "message");
  const workConversationKey = readWorkConversationKey(audit);
  if (!message) {
    throw new Error("message is required");
  }

  if (toolId === "workboard.subagent.spawn") {
    const executionProfile = requireHelperExecutionProfile(
      readString(record, "execution_profile"),
      { toolId },
    );
    const { subagent, reply } = await subagents.spawnAndRunSubagent({
      scope,
      subagent: {
        parent_conversation_key: workConversationKey,
        execution_profile: executionProfile,
        status: "running",
        work_item_id: readString(record, "work_item_id"),
        work_item_task_id: readString(record, "work_item_task_id"),
      },
      message,
      close_on_success: true,
    });
    return jsonResult(toolCallId, {
      subagent,
      reply,
    });
  }

  const subagentId = readString(record, "subagent_id");
  if (!subagentId) {
    throw new Error("subagent_id is required");
  }
  const { reply } = await subagents.sendSubagentMessage({
    scope,
    subagent_id: subagentId,
    parent_conversation_key: workConversationKey,
    message,
  });
  return jsonResult(toolCallId, { subagent_id: subagentId, reply });
}

export async function executeWorkboardTool(
  context: WorkboardToolExecutorContext,
  toolId: string,
  toolCallId: string,
  args: unknown,
  audit?: ToolExecutionAudit,
): Promise<ToolResult | undefined> {
  if (!toolId.startsWith("workboard.")) {
    return undefined;
  }

  if (toolId === "workboard.capture") {
    return await createCapture(context, toolCallId, args, audit);
  }

  const db = requireDb(context);
  const scope = requireWorkScope(context);
  const workboard = new WorkboardDal(db);
  const record = asRecord(args);
  const executionTurnId = audit?.execution_turn_id?.trim() || undefined;
  const workConversationKey = readWorkConversationKey(audit);

  const crudResult = await executeWorkboardCrudTool({
    context,
    toolId,
    toolCallId,
    args,
    audit,
  });
  if (crudResult) {
    return crudResult;
  }

  switch (toolId) {
    case "workboard.subagent.list":
      return jsonResult(
        toolCallId,
        await workboard.listSubagents({
          scope,
          statuses: readStringArray(record, "statuses") as
            | ("running" | "paused" | "closing" | "closed" | "failed")[]
            | undefined,
          work_item_id: readString(record, "work_item_id"),
          work_item_task_id: readString(record, "work_item_task_id"),
          execution_profile: readString(record, "execution_profile"),
          limit: readNumber(record, "limit"),
          cursor: readString(record, "cursor"),
        }),
      );
    case "workboard.subagent.get":
      return jsonResult(toolCallId, {
        subagent: await workboard.getSubagent({
          scope,
          subagent_id: readString(record, "subagent_id") ?? "",
        }),
      });
    case "workboard.subagent.spawn":
    case "workboard.subagent.send":
      return await executeSubagentSpawnOrSend(context, toolCallId, toolId, args, audit);
    case "workboard.subagent.close":
      return jsonResult(toolCallId, {
        subagent: await workboard.closeSubagent({
          scope,
          subagent_id: readString(record, "subagent_id") ?? "",
          reason: readString(record, "reason"),
        }),
      });
    case "workboard.clarification.list":
      return jsonResult(
        toolCallId,
        await workboard.listClarifications({
          scope,
          work_item_id: readString(record, "work_item_id"),
          statuses: readStringArray(record, "statuses") as
            | ("open" | "answered" | "cancelled")[]
            | undefined,
          limit: readNumber(record, "limit"),
          cursor: readString(record, "cursor"),
        }),
      );
    case "workboard.clarification.request": {
      const workItemId = readString(record, "work_item_id");
      const question = readString(record, "question");
      if (!workItemId || !question) {
        throw new Error("work_item_id and question are required");
      }
      const targetConversationKey = await resolveClarificationTargetConversationKey({
        db,
        scope,
        workItemId,
      });
      const clarification = await workboard.createClarification({
        scope,
        clarification: {
          work_item_id: workItemId,
          question,
          requested_by_subagent_id: extractSubagentIdFromConversationKey(workConversationKey),
          requested_for_conversation_key: targetConversationKey,
        },
      });
      await workboard.setStateKv({
        scope: { kind: "work_item", ...scope, work_item_id: workItemId },
        key: "work.refinement.phase",
        value_json: "awaiting_clarification",
        provenance_json: { source: "workboard.clarification.request" },
        updatedByTurnId: executionTurnId,
      });
      const requestingSubagentId = extractSubagentIdFromConversationKey(workConversationKey);
      if (requestingSubagentId) {
        await workboard.updateSubagent({
          scope,
          subagent_id: requestingSubagentId,
          patch: { status: "paused" },
        });
      }
      await new ConversationQueueSignalDal(db).setSignal({
        tenant_id: scope.tenant_id,
        key: targetConversationKey,
        kind: "steer",
        inbox_id: null,
        queue_mode: "steer",
        message_text: `Clarification needed for work item ${workItemId}: ${question}`,
        created_at_ms: Date.now(),
      });
      return jsonResult(toolCallId, { clarification });
    }
    case "workboard.clarification.answer": {
      const clarificationId = readString(record, "clarification_id");
      const answerText = readString(record, "answer_text");
      const answeredByConversationKey = workConversationKey;
      if (!clarificationId || !answerText || !answeredByConversationKey) {
        throw new Error(
          "clarification_id, answer_text, and an active work conversation are required",
        );
      }
      const clarificationBefore = await workboard.getClarification({
        scope,
        clarification_id: clarificationId,
      });
      const clarification =
        clarificationBefore?.status === "open"
          ? await workboard.answerClarification({
              scope,
              clarification_id: clarificationId,
              answer_text: answerText,
              answered_by_conversation_key: answeredByConversationKey,
            })
          : clarificationBefore;
      if (clarificationBefore?.status === "open" && clarification?.status === "answered") {
        await workboard.setStateKv({
          scope: { kind: "work_item", ...scope, work_item_id: clarification.work_item_id },
          key: "work.refinement.phase",
          value_json: "refining",
          provenance_json: { source: "workboard.clarification.answer" },
          updatedByTurnId: executionTurnId,
        });
        const tasks = await workboard.listTasks({
          scope,
          work_item_id: clarification.work_item_id,
        });
        const pausedPlannerTask = tasks.find(
          (task) => task.execution_profile === "planner" && task.status === "paused",
        );
        if (pausedPlannerTask) {
          await workboard.updateTask({
            scope,
            task_id: pausedPlannerTask.task_id,
            patch: {
              status: "queued",
              result_summary: "Clarification answered; resume refinement.",
            },
          });
        } else if (
          !tasks.some(
            (task) =>
              task.execution_profile === "planner" &&
              (task.status === "queued" || task.status === "leased" || task.status === "running"),
          )
        ) {
          await workboard.createTask({
            scope,
            task: {
              work_item_id: clarification.work_item_id,
              status: "queued",
              execution_profile: "planner",
              side_effect_class: "workspace",
              result_summary: "Resume refinement after clarification.",
            },
          });
        }
      }
      return jsonResult(toolCallId, { clarification });
    }
    case "workboard.clarification.cancel":
      return jsonResult(toolCallId, {
        clarification: await workboard.cancelClarification({
          scope,
          clarification_id: readString(record, "clarification_id") ?? "",
        }),
      });
    default:
      return {
        tool_call_id: toolCallId,
        output: "",
        error: `unknown workboard tool: ${toolId}`,
      };
  }
}
