import type { AgentTurnRequest, AgentTurnResponse } from "@tyrum/contracts";
import type {
  ExecutionBackend,
  ExecutionBackendStreamHandle,
  ExecutionBackendTurnOptions,
} from "../../agent/execution-backend.js";
import { HarnessUiMessageStream } from "../ui-message-stream.js";
import {
  CLAUDE_AGENT_SDK_BACKEND_ID,
  type ClaudeAgentSdkRunOptions,
  type ClaudeAgentSdkTurnPlan,
  type createClaudeAgentSdkBackend,
} from "./backend.js";
import type { HarnessTurnExecution } from "./planner.js";

/**
 * Adapts the harness backend to the `ExecutionBackend` port.
 *
 * Planning — resolving the conversation, its workspace root, the persona and
 * conversation-state checkpoint, pre-turn memory recall, and the role ceiling —
 * is injected rather than reached for directly, keeping adapter code isolated
 * behind the port as ARCH-22 requires.
 */
export function createClaudeAgentSdkExecutionBackend(deps: {
  backend: ReturnType<typeof createClaudeAgentSdkBackend>;
  plan: (
    input: AgentTurnRequest,
    execution?: HarnessTurnExecution,
  ) => Promise<ClaudeAgentSdkTurnPlan>;
}): ExecutionBackend {
  const run = async (
    input: AgentTurnRequest,
    opts: ExecutionBackendTurnOptions | undefined,
    runOptions?: ClaudeAgentSdkRunOptions,
  ): Promise<AgentTurnResponse> => {
    // The turn id attributes this turn's messages and approvals; the abort
    // signal is the turn deadline, without which the harness would keep running
    // (and keep executing tools) after the turn was marked failed.
    const plan = await deps.plan(input, { turnId: opts?.execution?.turnId });
    return await deps.backend.runTurn(plan, { ...runOptions, abortSignal: opts?.abortSignal });
  };

  return {
    id: CLAUDE_AGENT_SDK_BACKEND_ID,

    async executeTurn(
      input: AgentTurnRequest,
      opts?: ExecutionBackendTurnOptions,
    ): Promise<AgentTurnResponse> {
      return await run(input, opts);
    },

    async executeTurnStream(
      input: AgentTurnRequest,
      opts?: ExecutionBackendTurnOptions,
    ): Promise<ExecutionBackendStreamHandle> {
      // Harness output does not flow through the ai-sdk stream pipe: the shared
      // translation layer already produces `chat.ui-message.stream` chunks, so
      // this hands the caller a stream fed directly from that sink. The turn is
      // started here rather than in `finalize` so chunks flow while the caller
      // is still consuming the stream.
      const stream = new HarnessUiMessageStream();
      const turn = run(input, opts, { sink: stream.sink }).then(
        (response) => {
          stream.close();
          return response;
        },
        (error: unknown) => {
          stream.fail(error);
          throw error;
        },
      );
      // The caller decides when to await the turn; an unobserved rejection here
      // would otherwise take the process down before `finalize` is reached.
      void turn.catch(() => undefined);

      return {
        streamResult: { toUIMessageStream: () => stream.readable },
        finalize: async () => await turn,
      };
    },
  };
}
