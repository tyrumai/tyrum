import { createClaudeAgentSdkExecutionBackendFromServices } from "../../src/modules/harness/claude-agent-sdk/assembly.js";
import type {
  ClaudeQuery,
  ClaudeQueryInput,
  ClaudeSdkMessage,
} from "../../src/modules/harness/claude-agent-sdk/client.js";
import type {
  ConformanceAction,
  ConformancePermission,
  ConformanceSessionObservation,
  ConformanceTurnScript,
  ExecutionBackendConformanceFixture,
} from "./execution-backend-conformance.fixtures.js";

/**
 * The `claude_agent_sdk` conformance fixture.
 *
 * The vendor SDK is replaced by a scripted session that reproduces the parts of
 * its contract the adapter depends on, and nothing else:
 *
 *  - `PreToolUse` fires *before* the permission callback. The SDK's order is
 *    hooks -> deny -> ask -> mode -> allow -> `canUseTool`, and the adapter
 *    relies on it to pair a tool-use id with a `canUseTool` invocation that
 *    carries none.
 *  - a tool named in `allowedTools` **never reaches `canUseTool`**. The adapter
 *    therefore names none, and this fixture honours the list anyway so the
 *    shadowing hazard stays visible if one is ever added back.
 *  - a denial is returned as `{ behavior: "deny", message }`, and the message is
 *    what the model is told; the tool does not run.
 *  - a `resume` ref the harness no longer holds fails the session before it
 *    starts, which is what fresh-context recovery has to survive.
 *
 * No API key, no network, no subprocess: the suite drives the adapter, not the
 * harness.
 */

interface ClaudeScriptedCall {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly output: string;
}

function toClaudeCall(action: Exclude<ConformanceAction, { kind: "text" }>): ClaudeScriptedCall {
  if (action.kind === "read_file") {
    return { toolName: "Read", input: { file_path: action.path }, output: action.output };
  }
  return { toolName: "Bash", input: { command: action.command }, output: action.output };
}

/**
 * Tools the adapter asked the SDK to auto-allow.
 *
 * Read off the options object rather than through `ClaudeQueryInput`, which no
 * longer declares `allowedTools` at all: the fixture must still be able to
 * observe — and honour — a list if one is ever reintroduced, because a tool
 * named there never reaches `canUseTool`.
 */
function declaredAllowedTools(queryInput: ClaudeQueryInput): string[] {
  const options: Record<string, unknown> = { ...queryInput.options };
  const declared = options["allowedTools"];
  return Array.isArray(declared) ? declared.map((tool) => String(tool)) : [];
}

async function fireHook(
  queryInput: ClaudeQueryInput,
  event: "PreToolUse" | "PostToolUse",
  call: {
    callId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolResponse?: unknown;
  },
): Promise<void> {
  for (const group of queryInput.options.hooks[event] ?? []) {
    for (const hook of group.hooks) {
      await hook(
        {
          hook_event_name: event,
          tool_name: call.toolName,
          tool_input: call.toolInput,
          tool_response: call.toolResponse,
        },
        call.callId,
        {},
      );
    }
  }
}

async function* runClaudeSession(state: {
  queryInput: ClaudeQueryInput;
  turn: ConformanceTurnScript;
  permissions: ConformancePermission[];
  executed: string[];
  nextCallId: () => string;
}): AsyncGenerator<ClaudeSdkMessage> {
  const { queryInput, turn } = state;
  const allowedTools = declaredAllowedTools(queryInput);
  const replyChunks: string[] = [];

  if (turn.rejectsResume === true && queryInput.options.resume !== undefined) {
    // The harness-side continuity for this ref is gone.
    throw new Error(`no conversation found with session ID: ${queryInput.options.resume}`);
  }

  yield { type: "system", subtype: "init", session_id: turn.sessionRef };

  for (const action of turn.actions) {
    if (action.kind === "text") {
      replyChunks.push(action.text);
      yield { type: "assistant", message: { content: [{ type: "text", text: action.text }] } };
      continue;
    }

    const call = toClaudeCall(action);
    const callId = state.nextCallId();
    // Hooks run ahead of the permission callback, so the observation tap sees a
    // call even when the ask channel later refuses it.
    await fireHook(queryInput, "PreToolUse", {
      callId,
      toolName: call.toolName,
      toolInput: call.input,
    });

    let effectiveInput = call.input;
    if (!allowedTools.includes(call.toolName)) {
      const result = await queryInput.options.canUseTool(call.toolName, call.input, {});
      if (result.behavior === "deny") {
        state.permissions.push({
          toolName: call.toolName,
          allowed: false,
          message: result.message,
        });
        // A denied call never runs, so no `PostToolUse` and no output.
        continue;
      }
      state.permissions.push({ toolName: call.toolName, allowed: true });
      effectiveInput = result.updatedInput;
    }

    state.executed.push(call.toolName);
    await fireHook(queryInput, "PostToolUse", {
      callId,
      toolName: call.toolName,
      toolInput: effectiveInput,
      toolResponse: call.output,
    });
  }

  yield { type: "result", result: replyChunks.join("") };
}

export const CLAUDE_AGENT_SDK_CONFORMANCE_FIXTURE: ExecutionBackendConformanceFixture = {
  backendId: "claude_agent_sdk",
  toolNames: { readFile: "Read", shell: "Bash" },

  createScriptedBackend: ({ services, sink, script }) => {
    const sessions: ConformanceSessionObservation[] = [];
    const permissions: ConformancePermission[] = [];
    const executed: string[] = [];
    let turnIndex = 0;
    let callSeq = 0;

    const query: ClaudeQuery = (queryInput) => {
      const turn = script[turnIndex];
      turnIndex += 1;
      if (!turn) {
        throw new Error(`the conformance script has no session ${turnIndex}`);
      }
      sessions.push({
        resumeRef: queryInput.options.resume,
        systemPromptAppend: queryInput.options.systemPrompt.append,
        autoAllowedTools: declaredAllowedTools(queryInput),
      });
      return {
        [Symbol.asyncIterator]: () =>
          runClaudeSession({
            queryInput,
            turn,
            permissions,
            executed,
            nextCallId: () => `sdk-call-${(callSeq += 1)}`,
          }),
      };
    };

    const backend = createClaudeAgentSdkExecutionBackendFromServices({
      db: services.db,
      conversationDal: services.conversationDal,
      sessionDal: services.sessionDal,
      policyService: services.policyService,
      contextStore: services.contextStore,
      memoryDal: services.memoryDal,
      approvalDal: services.approvalDal,
      tenantId: services.tenantId,
      agentKey: services.agentKey,
      workspaceKey: services.workspaceKey,
      approvalWaitMs: services.approvalWaitMs,
      approvalPollMs: services.approvalPollMs,
      logger: services.logger,
      sink,
      resolveWorkspaceRoot: () => services.workspaceRoot,
      now: services.now,
      newId: services.newId,
      query,
    });

    return { backend, sessions, permissions, executed };
  },
};
