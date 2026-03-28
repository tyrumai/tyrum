import type { streamText } from "ai";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
} from "@tyrum/contracts";
import { AgentRuntime as RuntimeAgent } from "@tyrum/runtime-agent";
import {
  buildPrepareTurnDeps,
  buildTurnEngineBridgeDeps,
  buildTurnDirectDeps,
  gatewayRuntimeLifecycle,
  type GatewayAgentRuntimeDeps,
} from "./agent-runtime-gateway-lifecycle.js";
import { createDefaultAgentContextStore, type AgentContextStore } from "../context-store.js";
import { resolveAgentId } from "./turn-helpers.js";
import type { AgentContextReport, AgentRuntimeOptions } from "./types.js";
import { resolveAgentHome, resolveTyrumHome } from "../home.js";
import { ConversationDal } from "../conversation-dal.js";
import { McpManager } from "../mcp-manager.js";
import type { ApprovalDal } from "../../approval/dal.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import { ExecutionEngine } from "../../execution/engine.js";
import { resolveWorkspaceKey } from "../../workspace/id.js";
import { DEFAULT_TENANT_ID } from "../../identity/scope.js";
import type { PrepareTurnDeps } from "./turn-preparation.js";
import type { TurnExecutionContext } from "./turn-preparation.js";
import { type GuardianReviewDecisionCollectorResult } from "./turn-direct.js";
import type { TurnDirectDeps } from "./turn-direct-runtime-helpers.js";
import { type ConversationCompactionResult } from "./conversation-compaction-service.js";
import type { ToolDescriptor } from "../tools.js";
import type { GuardianReviewDecision } from "../../review/guardian-review-mode.js";
import { normalizeInternalTurnRequestIfNeeded } from "./turn-request-normalization.js";
import { resolveAgentTurnInput } from "./turn-helpers.js";
import { parseChannelSourceKey } from "../../channels/interface.js";
import { turnViaExecutionEngineStream as turnViaExecutionEngineStreamBridge } from "./turn-engine-bridge.js";

type IngressStreamOutcome = "completed" | "paused";
type IngressStreamResult = Pick<ReturnType<typeof streamText>, "toUIMessageStream">;

export class AgentRuntime extends RuntimeAgent<
  GatewayAgentRuntimeDeps,
  PluginRegistry,
  ExecutionEngine,
  AgentContextReport,
  ToolDescriptor,
  GuardianReviewDecision,
  GuardianReviewDecisionCollectorResult,
  ConversationCompactionResult,
  ReturnType<typeof streamText>
> {
  public readonly executionEngine: ExecutionEngine;
  public readonly opts: AgentRuntimeOptions;

  constructor(opts: AgentRuntimeOptions) {
    const agentIdCandidate = opts.agentId?.trim() || resolveAgentId();
    const home = opts.home ?? resolveAgentHome(resolveTyrumHome(), agentIdCandidate);
    const contextStore =
      opts.contextStore ??
      createDefaultAgentContextStore({
        home,
        container: opts.container,
      });
    const conversationDal = opts.conversationDal ?? opts.container.conversationDal;
    const fetchImpl = opts.fetchImpl ?? fetch;
    const mcpManager = opts.mcpManager ?? new McpManager({ logger: opts.container.logger });
    const policyService = opts.policyService ?? opts.container.policyService;
    const approvalDal = opts.approvalDal ?? opts.container.approvalDal;
    const executionEngine = new ExecutionEngine({
      db: opts.container.db,
      redactionEngine: opts.container.redactionEngine,
      logger: opts.container.logger,
    });

    super({
      deps: {
        opts,
        contextStore,
        conversationDal,
        fetchImpl,
        mcpManager,
        policyService,
        approvalDal,
      },
      defaultTenantId: DEFAULT_TENANT_ID,
      resolveDefaultAgentId: resolveAgentId,
      resolveDefaultWorkspaceId: () => resolveWorkspaceKey(),
      resolveHome: (nextAgentId) => opts.home ?? resolveAgentHome(resolveTyrumHome(), nextAgentId),
      executionPort: executionEngine,
      lifecycle: gatewayRuntimeLifecycle,
      onShutdown: async (context) => {
        await context.deps.mcpManager.shutdown();
      },
      tenantId: opts.tenantId,
      home,
      instanceOwner: opts.instanceOwner,
      agentId: opts.agentId,
      workspaceId: opts.workspaceId,
      languageModel: opts.languageModel,
      plugins: opts.plugins,
      maxSteps: opts.maxSteps,
      approvalWaitMs: opts.approvalWaitMs,
      approvalPollMs: opts.approvalPollMs,
      turnEngineWaitMs: opts.turnEngineWaitMs,
    });

    this.executionEngine = executionEngine;
    this.opts = opts;
  }

  get contextStore(): AgentContextStore {
    return this.deps.contextStore;
  }

  get conversationDal(): ConversationDal {
    return this.deps.conversationDal;
  }

  get fetchImpl(): typeof fetch {
    return this.deps.fetchImpl;
  }

  get mcpManager(): McpManager {
    return this.deps.mcpManager;
  }

  get policyService(): PolicyService {
    return this.deps.policyService;
  }

  get approvalDal(): ApprovalDal {
    return this.deps.approvalDal;
  }

  get prepareTurnDeps(): PrepareTurnDeps {
    return buildPrepareTurnDeps(this.getContext());
  }

  get turnDirectDeps(): TurnDirectDeps {
    return buildTurnDirectDeps(this.getContext());
  }

  async executeDecideAction(
    input: AgentTurnRequestT,
    opts?: { abortSignal?: AbortSignal; timeoutMs?: number; execution?: TurnExecutionContext },
  ): Promise<AgentTurnResponseT> {
    return await super.executeDecideAction(input, opts);
  }

  async turnIngressStream(input: AgentTurnRequestT): Promise<{
    finalize: () => Promise<AgentTurnResponseT>;
    outcome: Promise<IngressStreamOutcome>;
    conversationId: string;
    streamResult: IngressStreamResult;
  }> {
    const conversation = await this.ensureConversationForIngress(input);
    const context = this.getContext();
    let contextReport: AgentContextReport | undefined;
    const bridgeDeps = buildTurnEngineBridgeDeps(context, (next) => {
      contextReport = next;
      context.lastContextReport = next;
    });
    const turn = await turnViaExecutionEngineStreamBridge(bridgeDeps, input);

    return {
      finalize: async () =>
        await gatewayRuntimeLifecycle.finalizeTurnLifecycle(context, {
          turnInput: input,
          response: await turn.finalize(),
          contextReport,
        }),
      outcome: turn.outcome,
      conversationId: conversation.conversation_id,
      streamResult: turn.streamResult,
    };
  }

  private async ensureConversationForIngress(input: AgentTurnRequestT) {
    const normalizedInput = normalizeInternalTurnRequestIfNeeded(input);
    const resolvedInput = resolveAgentTurnInput(normalizedInput);
    const containerKind =
      normalizedInput.container_kind ?? resolvedInput.envelope?.container.kind ?? "channel";
    const parsedChannel = parseChannelSourceKey(resolvedInput.channel);

    return await this.conversationDal.getOrCreate({
      tenantId: this.tenantId,
      scopeKeys: {
        agentKey: normalizedInput.agent_key?.trim() || this.agentId,
        workspaceKey: normalizedInput.workspace_key?.trim() || this.workspaceId,
      },
      connectorKey: parsedChannel.connector,
      accountKey: resolvedInput.envelope?.delivery.account ?? parsedChannel.accountId,
      providerThreadId: resolvedInput.thread_id,
      containerKind,
    });
  }
}
