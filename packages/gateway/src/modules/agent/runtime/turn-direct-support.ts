import { stepCountIs, streamText } from "ai";
import type { AgentTurnResponse as AgentTurnResponseT, ConversationState } from "@tyrum/contracts";
import type { AgentContextReport } from "./types.js";
import type { prepareTurn } from "./turn-preparation.js";
import { GUARDIAN_REVIEW_DECISION_TOOL_ID } from "./tool-set-builder-internal-tools.js";

export type GuardianReviewDecisionCollectorResult = NonNullable<
  Awaited<ReturnType<typeof prepareTurn>>["guardianReviewDecisionCollector"]
>;

export interface TurnDirectResult {
  response: AgentTurnResponseT;
  contextReport: AgentContextReport;
  guardianReviewDecisionCollector?: GuardianReviewDecisionCollectorResult;
}

export interface TurnStreamDirectResult {
  streamResult: ReturnType<typeof streamText>;
  conversationId: string;
  contextReport: AgentContextReport;
  guardianReviewDecisionCollector?: GuardianReviewDecisionCollectorResult;
  finalize: () => Promise<AgentTurnResponseT>;
}

export type TurnInvocationOptions = {
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  execution?: {
    planId: string;
    runId: string;
    stepIndex: number;
    stepId: string;
    stepApprovalId?: string;
  };
  compactionRetried?: boolean;
};

export function createGuardianReviewTurnControl(): {
  stopWhen: Array<ReturnType<typeof stepCountIs>>;
  toolChoice: { type: "tool"; toolName: typeof GUARDIAN_REVIEW_DECISION_TOOL_ID };
  withinTurnLoop: { value: undefined };
} {
  return {
    stopWhen: [stepCountIs(1)],
    toolChoice: { type: "tool", toolName: GUARDIAN_REVIEW_DECISION_TOOL_ID },
    withinTurnLoop: { value: undefined },
  };
}

export function stripEmbeddedConversationContext(
  userContent: ReadonlyArray<
    | { type: "text"; text: string }
    | { type: "file"; data: string; mediaType: string; filename?: string }
  >,
  contextState: ConversationState | null | undefined,
): Array<
  | { type: "text"; text: string }
  | { type: "file"; data: string; mediaType: string; filename?: string }
> {
  const hasPromptInjectedContext = Boolean(
    contextState?.checkpoint ||
    contextState?.pending_approvals.length ||
    contextState?.pending_tool_state.length,
  );
  if (!hasPromptInjectedContext) {
    return [...userContent];
  }
  return userContent.filter(
    (part) => part.type !== "text" || !part.text.startsWith("Conversation state:\n"),
  );
}
