import type { PolicyService } from "@tyrum/runtime-policy";
import type { SqlDb } from "../../statestore/types.js";
import type { ProtocolDeps } from "../../ws/protocol.js";
import type { AgentContextStore } from "../agent/context-store.js";
import type { ConversationDal } from "../agent/conversation-dal.js";
import type { ExecutionBackend, HarnessExecutionBackends } from "../agent/execution-backend.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { MemoryDal } from "../memory/memory-dal.js";
import { createClaudeAgentSdkExecutionBackendFromServices } from "./claude-agent-sdk/assembly.js";
import type { HarnessPlannerLogger } from "./claude-agent-sdk/planner-inputs.js";
import type { HarnessTranslatorSink } from "./translation.js";

/**
 * Services a harness backend needs, all resolved from the same instances the
 * native path uses so a flagged conversation is governed by exactly the policy,
 * approval and transcript machinery an unflagged one is.
 */
export interface HarnessExecutionBackendDeps {
  readonly db: SqlDb;
  readonly conversationDal: ConversationDal;
  readonly contextStore: AgentContextStore;
  readonly memoryDal: MemoryDal;
  readonly policyService: PolicyService;
  readonly approvalDal: ApprovalDal;
  /** Enables live approval broadcasts to operator surfaces. */
  readonly protocolDeps?: ProtocolDeps;
  /** Tenant UUID this runtime serves. */
  readonly tenantId: string;
  /** Default agent *key* (not UUID). */
  readonly agentKey: string;
  /** Default workspace *key* (not UUID). */
  readonly workspaceKey: string;
  /**
   * Filesystem root the harness is confined to. Must be the same value the
   * native path passes to `canonicalizeToolMatchTarget` (the agent home);
   * anything else silently changes which `read:`/`write:` policy rules fire.
   */
  readonly workspaceRoot: string;
  readonly approvalWaitMs: number;
  readonly approvalPollMs: number;
  readonly logger: HarnessPlannerLogger;
  /** Raw deployment config; only the gateway state mode is read from it. */
  readonly deploymentConfig?: unknown;
  /**
   * Fallback sink for turns run through the **non-streaming**
   * `ExecutionBackend.executeTurn` port — channel deliveries and the
   * conversation turn loop — where no operator stream is subscribed and the
   * native backend emits nothing live either. Defaults to dropping frames.
   *
   * `executeTurnStream`, which is what the operator UI takes, ignores this and
   * installs a per-turn sink feeding the caller's stream, so live output does
   * not depend on this value. The durable transcript never does: the translator
   * accumulates parts independently of the sink.
   */
  readonly sink?: HarnessTranslatorSink;
}

/** No live subscriber on the non-streaming port path; see `sink` above. */
const DISCARDING_STREAM_SINK: HarnessTranslatorSink = {
  emitChunk: () => undefined,
};

/**
 * Builds the registry of harness backends this runtime can route to.
 *
 * Entries are lazy getters on purpose. "Flag off => zero impact" means a
 * deployment with no `conversation_execution_backend_overrides` row must not
 * pay for a backend it never uses, and the resolver only reads a key after it
 * has already established that an override names a non-native backend. So
 * merely wiring this registry allocates one object and nothing else: no DAL,
 * no approval router, no planner, and — because the vendor SDK is behind a
 * dynamic import inside the assembly's query thunk — no
 * `@anthropic-ai/claude-agent-sdk` load.
 *
 * A backend absent from this registry stays `UnavailableExecutionBackend`, so a
 * conversation flagged onto something the deployment has not wired up fails
 * loudly rather than silently running native.
 */
export function createHarnessExecutionBackends(
  deps: HarnessExecutionBackendDeps,
): HarnessExecutionBackends {
  let claudeAgentSdk: ExecutionBackend | undefined;

  return {
    get claude_agent_sdk(): ExecutionBackend {
      claudeAgentSdk ??= createClaudeAgentSdkExecutionBackendFromServices({
        db: deps.db,
        conversationDal: deps.conversationDal,
        contextStore: deps.contextStore,
        memoryDal: deps.memoryDal,
        policyService: deps.policyService,
        approvalDal: deps.approvalDal,
        protocolDeps: deps.protocolDeps,
        tenantId: deps.tenantId,
        agentKey: deps.agentKey,
        workspaceKey: deps.workspaceKey,
        resolveWorkspaceRoot: () => deps.workspaceRoot,
        approvalWaitMs: deps.approvalWaitMs,
        approvalPollMs: deps.approvalPollMs,
        logger: deps.logger,
        deploymentConfig: deps.deploymentConfig,
        sink: deps.sink ?? DISCARDING_STREAM_SINK,
      });
      return claudeAgentSdk;
    },
  };
}
