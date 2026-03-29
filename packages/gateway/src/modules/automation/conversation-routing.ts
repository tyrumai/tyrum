import {
  AgentConversationKey,
  DEFAULT_WORKSPACE_KEY,
  WorkspaceKey,
  parseTyrumKey,
} from "@tyrum/contracts";
import { buildAgentTurnKey } from "../agent/turn-key.js";

type ParsedAgentConversationKey = Extract<ReturnType<typeof parseTyrumKey>, { kind: "agent" }>;

type AutomationConversationTarget = {
  agentKey: string;
  workspaceKey: string;
  threadId: string;
};

type AutomationAccountScope = {
  workspaceKey: string;
  deliveryAccount: string;
};

export type AutomationConversationRoute = {
  agentKey: string;
  workspaceKey: string;
  deliveryAccount: string;
  threadId: string;
  containerKind: "channel";
};

type InvalidRequestError = Error & { code: "invalid_request" };

function buildAutomationConversationKey(input: AutomationConversationTarget): AgentConversationKey {
  return AgentConversationKey.parse(
    buildAgentTurnKey({
      agentId: input.agentKey,
      workspaceId: input.workspaceKey,
      channel: "automation",
      containerKind: "channel",
      threadId: input.threadId,
    }),
  );
}

function invalidAutomationConversationKey(message: string): InvalidRequestError {
  const err = new Error(message) as InvalidRequestError;
  err.name = "InvalidRequestError";
  err.code = "invalid_request";
  return err;
}

function parseAutomationAccountScope(account?: string): AutomationAccountScope {
  const [encodedWorkspaceKey, encodedDeliveryAccount] = account?.split("~", 2) ?? [];
  const parsedWorkspaceKey = WorkspaceKey.safeParse(encodedWorkspaceKey?.trim() ?? "");
  if (parsedWorkspaceKey.success) {
    return {
      workspaceKey: parsedWorkspaceKey.data,
      deliveryAccount: encodedDeliveryAccount?.trim() || "default",
    };
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
  return parseAutomationAccountScope(parsedKey.account).workspaceKey;
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

export function resolveAutomationConversationRoute(
  conversationKey: AgentConversationKey,
): AutomationConversationRoute {
  const parsedKey = parseTyrumKey(conversationKey);
  if (parsedKey.kind !== "agent" || parsedKey.thread_kind !== "channel") {
    throw invalidAutomationConversationKey(
      "automation conversation_key must use the canonical agent:<agent>:automation:<workspace>:channel:<thread> form",
    );
  }
  if (parsedKey.channel !== "automation") {
    throw invalidAutomationConversationKey(
      "heartbeat schedule key must target the automation conversation surface",
    );
  }

  const accountScope = parseAutomationAccountScope(parsedKey.account);
  return {
    agentKey: parsedKey.agent_key,
    workspaceKey: accountScope.workspaceKey,
    deliveryAccount: accountScope.deliveryAccount,
    threadId: parsedKey.id,
    containerKind: "channel",
  };
}
