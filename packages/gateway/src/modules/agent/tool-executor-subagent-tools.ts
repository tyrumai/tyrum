import { SubagentService } from "../workboard/subagent-service.js";
import type { ToolExecutionAudit, ToolResult } from "./tool-executor-shared.js";
import {
  asRecord,
  jsonResult,
  readNumber,
  readString,
  readStringArray,
  requireDb,
  requireWorkScope,
  type WorkboardToolExecutorContext,
} from "./tool-executor-workboard-tools-shared.js";

const HELPER_EXECUTION_PROFILES = new Set(["explorer_ro", "reviewer_ro", "jury"]);

function requireParentSessionKey(audit?: ToolExecutionAudit): string {
  const sessionKey = audit?.work_session_key?.trim();
  if (!sessionKey) {
    throw new Error("subagent tools require an active work_session_key");
  }
  return sessionKey;
}

function requireHelperExecutionProfile(raw: string | undefined): string {
  const executionProfile = raw?.trim();
  if (!executionProfile) {
    throw new Error("execution_profile is required");
  }
  if (!HELPER_EXECUTION_PROFILES.has(executionProfile)) {
    throw new Error(
      `execution_profile must be one of: ${Array.from(HELPER_EXECUTION_PROFILES).join(", ")}`,
    );
  }
  return executionProfile;
}

export async function executeSubagentTool(
  context: WorkboardToolExecutorContext,
  toolId: string,
  toolCallId: string,
  args: unknown,
  audit?: ToolExecutionAudit,
): Promise<ToolResult | undefined> {
  if (!toolId.startsWith("subagent.")) {
    return undefined;
  }

  const db = requireDb(context);
  const scope = requireWorkScope(context);
  const subagents = new SubagentService({ db, agents: context.agents });
  const record = asRecord(args);
  const parentSessionKey = requireParentSessionKey(audit);

  switch (toolId) {
    case "subagent.list":
      return jsonResult(
        toolCallId,
        await subagents.listSubagents({
          scope,
          parent_session_key: parentSessionKey,
          statuses: readStringArray(record, "statuses") as
            | ("running" | "paused" | "closing" | "closed" | "failed")[]
            | undefined,
          limit: readNumber(record, "limit"),
          cursor: readString(record, "cursor"),
        }),
      );
    case "subagent.get": {
      const subagentId = readString(record, "subagent_id");
      if (!subagentId) {
        throw new Error("subagent_id is required");
      }
      return jsonResult(toolCallId, {
        subagent: await subagents.getSubagent({
          scope,
          subagent_id: subagentId,
          parent_session_key: parentSessionKey,
        }),
      });
    }
    case "subagent.spawn": {
      const executionProfile = requireHelperExecutionProfile(
        readString(record, "execution_profile"),
      );
      const message = readString(record, "message");
      if (!message) {
        throw new Error("message is required");
      }
      const { subagent, reply } = await subagents.spawnAndRunSubagent({
        scope,
        subagent: {
          parent_session_key: parentSessionKey,
          execution_profile: executionProfile,
          lane: "subagent",
          status: "running",
        },
        message,
      });
      return jsonResult(toolCallId, {
        subagent,
        reply,
      });
    }
    case "subagent.send": {
      const subagentId = readString(record, "subagent_id");
      const message = readString(record, "message");
      if (!subagentId || !message) {
        throw new Error("subagent_id and message are required");
      }
      const { reply } = await subagents.sendSubagentMessage({
        scope,
        subagent_id: subagentId,
        parent_session_key: parentSessionKey,
        message,
      });
      return jsonResult(toolCallId, {
        subagent_id: subagentId,
        reply,
      });
    }
    case "subagent.close": {
      const subagentId = readString(record, "subagent_id");
      if (!subagentId) {
        throw new Error("subagent_id is required");
      }
      return jsonResult(toolCallId, {
        subagent: await subagents.closeSubagent({
          scope,
          subagent_id: subagentId,
          parent_session_key: parentSessionKey,
          reason: readString(record, "reason"),
        }),
      });
    }
    default:
      return undefined;
  }
}
