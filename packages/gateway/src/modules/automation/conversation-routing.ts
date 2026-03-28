import {
  DEFAULT_WORKSPACE_KEY,
  WorkspaceKey,
  type AgentConversationKey,
  parseTyrumKey,
} from "@tyrum/contracts";
import { buildAgentTurnKey } from "../agent/turn-key.js";

type ParsedAgentConversationKey = Extract<ReturnType<typeof parseTyrumKey>, { kind: "agent" }>;

type AutomationConversationTarget = {
  agentKey: string;
  workspaceKey: string;
  threadId: string;
};

type InvalidRequestError = Error & { code: "invalid_request" };

function buildAutomationConversationKey(input: AutomationConversationTarget): AgentConversationKey {
  return buildAgentTurnKey({
    agentId: input.agentKey,
    workspaceId: input.workspaceKey,
    channel: "automation",
    containerKind: "channel",
    threadId: input.threadId,
  }) as AgentConversationKey;
}

function invalidAutomationConversationKey(message: string): InvalidRequestError {
  const err = new Error(message) as InvalidRequestError;
  err.name = "InvalidRequestError";
  err.code = "invalid_request";
  return err;
}

function workspaceKeyFromAutomationAccount(account?: string): string {
  const encodedWorkspaceKey = account?.split("~", 1)[0]?.trim();
  const parsedWorkspaceKey = WorkspaceKey.safeParse(encodedWorkspaceKey ?? "");
  if (parsedWorkspaceKey.success) {
    return parsedWorkspaceKey.data;
  }
  throw invalidAutomationConversationKey(
    "automation conversation_key must encode a valid workspace account segment",
  );
}

function automationWorkspaceKey(parsedKey: ParsedAgentConversationKey): string | undefined {
  if (!("channel" in parsedKey) || parsedKey.channel !== "automation") {
    return undefined;
  }
  if (parsedKey.thread_kind !== "channel") {
    throw invalidAutomationConversationKey(
      "automation conversation_key must use the canonical agent:<agent>:automation:<workspace>:channel:<thread> form",
    );
  }
  return workspaceKeyFromAutomationAccount(parsedKey.account);
}

export function resolveAgentConversationScope(conversationKey: AgentConversationKey): {
  agentKey: string;
  workspaceKey: string;
  parsedKey: ParsedAgentConversationKey;
} {
  const parsedKey = parseTyrumKey(conversationKey);
  if (parsedKey.kind !== "agent") {
    throw new Error("conversation_key must target an agent conversation");
  }

  const workspaceKey = automationWorkspaceKey(parsedKey);

  if (parsedKey.thread_kind === "main" || parsedKey.thread_kind === "dm") {
    return {
      agentKey: parsedKey.agent_key,
      workspaceKey: DEFAULT_WORKSPACE_KEY,
      parsedKey,
    };
  }

  return {
    agentKey: parsedKey.agent_key,
    workspaceKey: workspaceKey ?? DEFAULT_WORKSPACE_KEY,
    parsedKey,
  };
}

export function buildHeartbeatConversationKey(input: {
  agentKey: string;
  workspaceKey: string;
}): AgentConversationKey {
  return buildAutomationConversationKey({
    agentKey: input.agentKey,
    workspaceKey: input.workspaceKey,
    threadId: "heartbeat",
  });
}

export function buildScheduleConversationKey(input: {
  agentKey: string;
  workspaceKey: string;
  scheduleId: string;
}): AgentConversationKey {
  return buildAutomationConversationKey({
    agentKey: input.agentKey,
    workspaceKey: input.workspaceKey,
    threadId: `schedule-${input.scheduleId.trim()}`,
  });
}

export function buildHookConversationKey(input: {
  agentKey: string;
  workspaceKey: string;
  hookKey: string;
}): AgentConversationKey {
  const hookSuffix = input.hookKey.replace(/^hook:/, "").trim();
  return buildAutomationConversationKey({
    agentKey: input.agentKey,
    workspaceKey: input.workspaceKey,
    threadId: `hook-${hookSuffix || input.hookKey.trim()}`,
  });
}

export function buildLocationTriggerConversationKey(input: {
  agentKey: string;
  workspaceKey: string;
  triggerId: string;
}): AgentConversationKey {
  return buildAutomationConversationKey({
    agentKey: input.agentKey,
    workspaceKey: input.workspaceKey,
    threadId: `location-${input.triggerId.trim()}`,
  });
}
