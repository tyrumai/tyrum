import { WorkspaceId } from "@tyrum/schemas";
import type { PolicyService } from "../policy/service.js";
import { PolicyService as PolicyServiceImpl } from "../policy/service.js";
import type { GatewayContainer } from "../../container.js";
import type { ApprovalNotifier } from "../approval/notifier.js";
import type { SecretProvider } from "../secret/provider.js";
import { createSecretProviderFromEnv } from "../secret/create-secret-provider.js";
import { join } from "node:path";
import type { Logger } from "../observability/logger.js";
import { AgentRuntime } from "./runtime.js";
import type { PluginRegistry } from "../plugins/registry.js";
import type { LanguageModel } from "ai";
import { TokenStore } from "../auth/token-store.js";

function normalizeAgentId(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return "default";
  if (trimmed === "default") return "default";
  const parsed = WorkspaceId.safeParse(trimmed);
  if (!parsed.success) {
    throw new Error(
      `invalid agent_id '${trimmed}' (expected a DNS-label like 'default' or 'agent-1')`,
    );
  }
  return parsed.data;
}

export class AgentRegistry {
  private readonly runtimeByAgentId = new Map<string, Promise<AgentRuntime>>();
  private readonly secretProviderByAgentId = new Map<string, Promise<SecretProvider>>();
  private readonly policyServiceByAgentId = new Map<string, PolicyService>();
  private readonly tokenStore: TokenStore;
  private adminTokenPromise: Promise<string> | undefined;

  constructor(
    private readonly opts: {
      container: GatewayContainer;
      baseHome: string;
      defaultSecretProvider: SecretProvider;
      defaultPolicyService: PolicyService;
      /** Optional global LanguageModel override (primarily for tests). */
      defaultLanguageModel?: LanguageModel;
      approvalNotifier: ApprovalNotifier;
      plugins?: PluginRegistry;
      logger: Logger;
    },
  ) {
    this.tokenStore = new TokenStore(opts.baseHome);
  }

  private getAdminToken(): Promise<string> {
    if (!this.adminTokenPromise) {
      this.adminTokenPromise = this.tokenStore.initialize();
    }
    return this.adminTokenPromise;
  }

  resolveAgentHome(agentId: string): string {
    const id = normalizeAgentId(agentId);
    if (id === "default") return this.opts.baseHome;
    return join(this.opts.baseHome, "agents", id);
  }

  getPolicyService(agentId: string): PolicyService {
    const id = normalizeAgentId(agentId);
    if (id === "default") return this.opts.defaultPolicyService;
    const existing = this.policyServiceByAgentId.get(id);
    if (existing) return existing;

    const home = this.resolveAgentHome(id);
    const service = new PolicyServiceImpl({
      home,
      snapshotDal: this.opts.container.policySnapshotDal,
      overrideDal: this.opts.container.policyOverrideDal,
    });
    this.policyServiceByAgentId.set(id, service);
    return service;
  }

  async getSecretProvider(agentId: string): Promise<SecretProvider> {
    const id = normalizeAgentId(agentId);
    if (id === "default") return this.opts.defaultSecretProvider;

    const cached = this.secretProviderByAgentId.get(id);
    if (cached) return await cached;

    const promise = this.getAdminToken()
      .then((token) => createSecretProviderFromEnv(this.resolveAgentHome(id), token))
      .catch((err) => {
        this.secretProviderByAgentId.delete(id);
        throw err;
      });
    this.secretProviderByAgentId.set(id, promise);
    return await promise;
  }

  async getRuntime(agentId: string): Promise<AgentRuntime> {
    const id = normalizeAgentId(agentId);
    const existing = this.runtimeByAgentId.get(id);
    if (existing) return await existing;

    const promise = (async () => {
      const home = this.resolveAgentHome(id);
      const secretProvider = await this.getSecretProvider(id);
      const policyService = this.getPolicyService(id);

      const runtime = new AgentRuntime({
        container: this.opts.container,
        home,
        fetchImpl: fetch,
        agentId: id,
        workspaceId: id,
        languageModel: this.opts.defaultLanguageModel,
        secretProvider,
        approvalNotifier: this.opts.approvalNotifier,
        plugins: this.opts.plugins,
        policyService,
      });

      this.opts.logger.info("agents.runtime_ready", {
        agent_id: id,
        home,
        workspace_id: id,
      });

      return runtime;
    })().catch((err) => {
      this.runtimeByAgentId.delete(id);
      throw err;
    });

    this.runtimeByAgentId.set(id, promise);
    return await promise;
  }

  async shutdown(): Promise<void> {
    const runtimes = await Promise.allSettled(this.runtimeByAgentId.values());
    const shutdowns: Promise<unknown>[] = [];
    for (const settled of runtimes) {
      if (settled.status === "fulfilled") {
        shutdowns.push(settled.value.shutdown());
      }
    }
    await Promise.allSettled(shutdowns);
  }
}
