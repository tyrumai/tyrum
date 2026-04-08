import type {
  Approval,
  BenchmarkQuestionExcerpt,
  BenchmarkTraceSummary,
  ContextReport,
  WsToolLifecycleEventPayload,
} from "@tyrum/contracts";

type SummaryInput = {
  toolEvents: readonly WsToolLifecycleEventPayload[];
  contextReports: readonly ContextReport[];
  approvals: readonly Approval[];
  assistantMessages: readonly BenchmarkQuestionExcerpt[];
  finalReply: string | null;
  requiredToolFamilies: readonly string[];
  disallowedToolFamilies: readonly string[];
  seededFacts: readonly string[];
};

const TOOL_FAILURE_STATUSES = new Set(["failed", "output-error", "output-denied", "cancelled"]);

function deriveToolFamily(toolId: string): string {
  const segments = toolId.split(".").filter((segment) => segment.length > 0);
  if (segments.length <= 1) {
    return `${toolId}.`;
  }
  if (segments[0] === "sandbox") {
    return "sandbox.";
  }
  return `${segments.slice(0, 2).join(".")}.`;
}

function collectToolFamilies(toolIds: readonly string[]): string[] {
  return [...new Set(toolIds.map(deriveToolFamily))].toSorted();
}

function matchesFamily(toolId: string, family: string): boolean {
  return toolId.startsWith(family);
}

function findRequiredFamiliesMissing(
  toolIds: readonly string[],
  requiredFamilies: readonly string[],
): string[] {
  return requiredFamilies.filter(
    (family) => !toolIds.some((toolId) => matchesFamily(toolId, family)),
  );
}

function findForbiddenFamiliesUsed(
  toolIds: readonly string[],
  forbiddenFamilies: readonly string[],
): string[] {
  return forbiddenFamilies.filter((family) =>
    toolIds.some((toolId) => matchesFamily(toolId, family)),
  );
}

function countRepeatedFailures(toolEvents: readonly WsToolLifecycleEventPayload[]): number {
  const failureCounts = new Map<string, number>();

  for (const event of toolEvents) {
    if (!TOOL_FAILURE_STATUSES.has(event.status)) continue;
    const key = `${event.tool_id}\n${event.error ?? event.summary}`;
    failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1);
  }

  let repeatedFailures = 0;
  for (const count of failureCounts.values()) {
    if (count > 1) repeatedFailures += count - 1;
  }
  return repeatedFailures;
}

function countExplicitRefusals(messages: readonly BenchmarkQuestionExcerpt[]): {
  count: number;
  messages: BenchmarkQuestionExcerpt[];
} {
  const refusalPattern =
    /\b(?:cannot|can't|unable|won't|will not|do not have access|don't have access|refuse)\b/i;
  const refusalMessages = messages.filter((message) => refusalPattern.test(message.text));
  return {
    count: refusalMessages.length,
    messages: refusalMessages,
  };
}

function countQuestionMessages(
  messages: readonly BenchmarkQuestionExcerpt[],
): BenchmarkQuestionExcerpt[] {
  return messages.filter((message) => message.text.includes("?"));
}

export function summarizeBenchmarkTrace(input: SummaryInput): BenchmarkTraceSummary {
  const lastToolStateByCallId = new Map<string, WsToolLifecycleEventPayload>();
  for (const event of input.toolEvents) {
    lastToolStateByCallId.set(event.tool_call_id, event);
  }

  const lastToolStates = [...lastToolStateByCallId.values()];
  const toolIds = [...new Set(lastToolStates.map((event) => event.tool_id))].toSorted();
  const questionMessages = countQuestionMessages(input.assistantMessages);
  const refusalSummary = countExplicitRefusals(input.assistantMessages);
  const latestContext = input.contextReports.at(-1);
  const approvalsRequested = input.approvals.filter((approval) =>
    ["queued", "reviewing", "awaiting_human"].includes(approval.status),
  ).length;
  const approvalsApproved = input.approvals.filter(
    (approval) => approval.status === "approved",
  ).length;
  const approvalsDenied = input.approvals.filter((approval) => approval.status === "denied").length;
  const browserCalls = lastToolStates.filter((event) =>
    event.tool_id.startsWith("tool.browser."),
  ).length;
  const sandboxRequest = lastToolStates.some((event) => event.tool_id === "sandbox.request");
  const sandboxRequestAttached = input.toolEvents.some(
    (event) =>
      event.tool_id === "sandbox.request" && event.summary.toLowerCase().includes("attached"),
  );
  const sandboxCurrentAttached = input.toolEvents.some(
    (event) =>
      event.tool_id === "sandbox.current" && event.summary.toLowerCase().includes("attached"),
  );

  return {
    tools: {
      calls_total: lastToolStates.length,
      failed_calls: lastToolStates.filter((event) => TOOL_FAILURE_STATUSES.has(event.status))
        .length,
      repeated_failed_calls: countRepeatedFailures(input.toolEvents),
      ids_used: toolIds,
      families_used: collectToolFamilies(toolIds),
      required_families_missing: findRequiredFamiliesMissing(toolIds, input.requiredToolFamilies),
      forbidden_families_used: findForbiddenFamiliesUsed(toolIds, input.disallowedToolFamilies),
    },
    messages: {
      assistant_question_count: questionMessages.length,
      assistant_question_messages: questionMessages,
      explicit_refusal_count: refusalSummary.count,
      explicit_refusal_messages: refusalSummary.messages,
      final_reply_present: Boolean(input.finalReply && input.finalReply.trim().length > 0),
    },
    memory: {
      keyword_hits: latestContext?.memory.keyword_hits ?? 0,
      semantic_hits: latestContext?.memory.semantic_hits ?? 0,
      seeded_facts: [...input.seededFacts],
    },
    approvals: {
      requested: approvalsRequested,
      approved: approvalsApproved,
      denied: approvalsDenied,
    },
    browser: {
      used: browserCalls > 0,
      tool_calls: browserCalls,
    },
    sandbox: {
      requested: sandboxRequest,
      attached: sandboxRequestAttached || sandboxCurrentAttached,
      released: lastToolStates.some((event) => event.tool_id === "sandbox.release"),
    },
    secrets: {
      secret_tool_calls: lastToolStates.filter((event) => event.tool_id.startsWith("tool.secret."))
        .length,
    },
  };
}

export function createQuestionExcerpt(ref: string, text: string): BenchmarkQuestionExcerpt {
  return { ref, text };
}
