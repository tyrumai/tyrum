import type { streamText } from "ai";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
} from "@tyrum/contracts";
import { AgentRuntime as RuntimeAgent } from "@tyrum/runtime-agent";
import {
  buildPrepareTurnDeps,
  buildTurnDirectDeps,
  gatewayRuntimeLifecycle,
  type GatewayAgentRuntimeDeps,
} from "./agent-runtime-gateway-lifecycle.js";
import { createDefaultAgentContextStore, type AgentContextStore } from "../context-store.js";
import { resolveAgentId } from "./turn-helpers.js";
import type { AgentContextReport, AgentRuntimeOptions } from "./types.js";
import { resolveAgentHome, resolveTyrumHome } from "../home.js";
import { SessionDal } from "../session-dal.js";
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
import { type SessionCompactionResult } from "./session-compaction-service.js";
import type { ToolDescriptor } from "../tools.js";
import type { GuardianReviewDecision } from "../../review/guardian-review-mode.js";

export class AgentRuntime extends RuntimeAgent<
  GatewayAgentRuntimeDeps,
  PluginRegistry,
  ExecutionEngine,
  AgentContextReport,
  ToolDescriptor,
  GuardianReviewDecision,
  GuardianReviewDecisionCollectorResult,
  SessionCompactionResult,
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
    const sessionDal = opts.sessionDal ?? opts.container.sessionDal;
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
        sessionDal,
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

  get sessionDal(): SessionDal {
    return this.deps.sessionDal;
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
}
