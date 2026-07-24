import {
  createClaudeAgentSdkBackend,
  type ClaudeAgentSdkTurnPlan,
} from "../../src/modules/harness/claude-agent-sdk/backend.js";
import type {
  ClaudeQueryInput,
  ClaudeSdkMessage,
} from "../../src/modules/harness/claude-agent-sdk/client.js";
import type { UiMessageChunk } from "../../src/modules/harness/translation.js";
import type {
  HarnessApprovalDecision,
  HarnessTurnContext,
} from "../../src/modules/harness/types.js";

export const CONTEXT: HarnessTurnContext = {
  backendId: "claude_agent_sdk",
  tenantId: "tenant-1",
  agentId: "agent-1",
  workspaceId: "workspace-1",
  conversationId: "conv-1",
  conversationKey: "conv-key-1",
  channel: "web",
  threadId: "thread-1",
  turnId: "turn-1",
  workspaceRoot: "/workspace",
};

export const PLAN: ClaudeAgentSdkTurnPlan = {
  context: CONTEXT,
  prompt: "list the files",
  systemPromptAppend: "You are Tyrum.",
};

/**
 * Drives the adapter with a scripted SDK conversation, exercising the real
 * permission callback and hooks the adapter installs.
 */
export function harness(input: {
  decision?: HarnessApprovalDecision;
  /** Fails the persist call, so a secondary failure cannot mask the first. */
  persistFails?: boolean;
  /** The harness rejects the resume ref, as it does once continuity is gone. */
  failWhenResuming?: boolean;
  /** Observes the abort signal the adapter forwards to the approval router. */
  captureAbortSignal?: (signal: AbortSignal | undefined) => void;
  /** Messages yielded before the script runs, e.g. the model's tool_use blocks. */
  preludeMessages?: ClaudeSdkMessage[];
  script?: (io: {
    canUseTool: ClaudeQueryInput["options"]["canUseTool"];
    hooks: ClaudeQueryInput["options"]["hooks"];
  }) => Promise<ClaudeSdkMessage[]>;
}) {
  const chunks: UiMessageChunk[] = [];
  const persisted: Array<Record<string, unknown>> = [];
  const sessions: string[] = [];
  const evaluated: Array<{ toolName: string; callId: string }> = [];
  const warnings: string[] = [];
  const forgotten: boolean[] = [];
  const resumes: Array<string | undefined> = [];
  let capturedOptions: ClaudeQueryInput["options"] | undefined;
  let seq = 0;

  const backend = createClaudeAgentSdkBackend({
    query: (queryInput) => {
      capturedOptions = queryInput.options;
      resumes.push(queryInput.options.resume);
      const runner = input.script ?? (async () => []);
      const rejectResume =
        input.failWhenResuming === true && queryInput.options.resume !== undefined;
      return {
        async *[Symbol.asyncIterator]() {
          if (rejectResume) {
            throw new Error(`no conversation found with session ID: ${queryInput.options.resume}`);
          }
          yield { type: "system", subtype: "init", session_id: "sdk-session-1" };
          for (const message of input.preludeMessages ?? []) {
            yield message;
          }
          for (const message of await runner({
            canUseTool: queryInput.options.canUseTool,
            hooks: queryInput.options.hooks,
          })) {
            yield message;
          }
          yield { type: "result", result: "done" };
        },
      };
    },
    approvalRouter: {
      evaluate: async ({ call, abortSignal }) => {
        evaluated.push({ toolName: call.toolName, callId: call.callId });
        input.captureAbortSignal?.(abortSignal);
        return input.decision ?? { kind: "allow" };
      },
    },
    sink: { emitChunk: (chunk) => void chunks.push(chunk) },
    rememberSession: async ({ sessionRef }) => void sessions.push(sessionRef),
    forgetSession: async () => void forgotten.push(true),
    persistTurn: async (turn) => {
      persisted.push({ ...turn });
      if (input.persistFails) throw new Error("transcript write failed");
      return {
        reply: turn.reply,
        conversation_id: "00000000-0000-4000-8000-000000000000",
        conversation_key: CONTEXT.conversationKey,
        attachments: [],
        used_tools: [...turn.usedTools],
        memory_written: false,
      };
    },
    logger: { info: () => {}, warn: (message) => void warnings.push(message) },
    newId: () => `id-${++seq}`,
  });

  return {
    backend,
    chunks,
    persisted,
    sessions,
    evaluated,
    warnings,
    forgotten,
    resumes,
    options: () => capturedOptions,
  };
}

export function preToolUse(toolName: string, toolInput: Record<string, unknown>) {
  return { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput };
}
