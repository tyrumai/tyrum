import { randomUUID } from "node:crypto";
import type { ApprovalDal } from "../../approval/dal.js";
import type { ExecutionBackend } from "../../agent/execution-backend.js";
import type { ProtocolDeps } from "../../../ws/protocol.js";
import { createHarnessApprovalRouter } from "../approval-router.js";
import { HarnessSessionDal } from "../session-dal.js";
import type { HarnessTranslatorSink } from "../translation.js";
import { CLAUDE_AGENT_SDK_BACKEND_ID, createClaudeAgentSdkBackend } from "./backend.js";
import { loadClaudeQuery, type ClaudeQuery } from "./client.js";
import { createClaudeAgentSdkExecutionBackend } from "./execution-backend.js";
import { createClaudeAgentSdkTurnPlanner, type ClaudeAgentSdkPlannerDeps } from "./planner.js";
import { CLAUDE_AGENT_SDK_TOOL_MAP } from "./tool-map.js";

export type ClaudeAgentSdkAssemblyDeps = Omit<ClaudeAgentSdkPlannerDeps, "sessionDal"> & {
  /** Defaults to a `HarnessSessionDal` over the supplied database. */
  readonly sessionDal?: HarnessSessionDal;
  readonly approvalDal: ApprovalDal;
  /** Enables live approval broadcasts to operator surfaces. */
  readonly protocolDeps?: ProtocolDeps;
  readonly approvalWaitMs: number;
  readonly approvalPollMs: number;
  /** Where `chat.ui-message.stream` frames for this turn are delivered. */
  readonly sink: HarnessTranslatorSink;
  /**
   * The SDK entry point. Defaults to a thunk that imports
   * `@anthropic-ai/claude-agent-sdk` on first iteration, so building this
   * backend costs nothing until a turn actually runs — and so the conformance
   * suite can drive the whole assembly without an API key.
   */
  readonly query?: ClaudeQuery;
  /** Approval-router clock seams, injected by tests. */
  readonly approvalNow?: () => number;
  readonly approvalSleep?: (ms: number) => Promise<void>;
};

/**
 * Defers loading the vendor SDK until the first message is pulled.
 *
 * `ClaudeQuery` returns an `AsyncIterable` synchronously, so the import cannot
 * be awaited at construction without dragging the SDK — and the platform binary
 * it bundles — onto the startup path, which "flag off => zero impact" forbids.
 */
function lazyClaudeQuery(): ClaudeQuery {
  return (input) => ({
    async *[Symbol.asyncIterator]() {
      const query = await loadClaudeQuery();
      yield* query(input);
    },
  });
}

/**
 * Builds the complete `claude_agent_sdk` execution backend from real services.
 *
 * This is the single composition point for the adapter: planner (conversation,
 * prompt, persona/checkpoint/recall append, resume ref, read-only fast path),
 * approval router (the shared ask channel), the SDK adapter itself, and the
 * `ExecutionBackend` port wrapper. Register the result under
 * `claude_agent_sdk` in the resolver's `harnessBackends`; a conversation with no
 * override row never reaches it.
 */
export function createClaudeAgentSdkExecutionBackendFromServices(
  deps: ClaudeAgentSdkAssemblyDeps,
): ExecutionBackend {
  const sessionDal = deps.sessionDal ?? new HarnessSessionDal(deps.db);
  const newId = deps.newId ?? (() => randomUUID());
  const planner = createClaudeAgentSdkTurnPlanner({ ...deps, sessionDal });

  const approvalRouter = createHarnessApprovalRouter({
    policyService: deps.policyService,
    approvalDal: deps.approvalDal,
    protocolDeps: deps.protocolDeps,
    toolMap: CLAUDE_AGENT_SDK_TOOL_MAP,
    approvalWaitMs: deps.approvalWaitMs,
    approvalPollMs: deps.approvalPollMs,
    logger: deps.logger,
    now: deps.approvalNow,
    sleep: deps.approvalSleep,
  });

  const backend = createClaudeAgentSdkBackend({
    query: deps.query ?? lazyClaudeQuery(),
    approvalRouter,
    sink: deps.sink,
    rememberSession: async ({ context, sessionRef }) => {
      await sessionDal.set({
        tenantId: context.tenantId,
        conversationId: context.conversationId,
        backendId: CLAUDE_AGENT_SDK_BACKEND_ID,
        sessionRef,
      });
    },
    forgetSession: async ({ context }) => {
      await sessionDal.clear({
        tenantId: context.tenantId,
        conversationId: context.conversationId,
        backendId: CLAUDE_AGENT_SDK_BACKEND_ID,
      });
    },
    persistTurn: async (input) => await planner.persistTurn(input),
    logger: deps.logger,
    newId,
  });

  return createClaudeAgentSdkExecutionBackend({
    backend,
    plan: async (input, execution) => await planner.plan(input, execution),
  });
}
