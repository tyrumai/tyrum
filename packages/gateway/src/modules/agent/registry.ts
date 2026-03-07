import { AgentKey } from "@tyrum/schemas";
import { readdir } from "node:fs/promises";
import type { PolicyService } from "../policy/service.js";
import { PolicyService as PolicyServiceImpl } from "../policy/service.js";
import type { GatewayContainer } from "../../container.js";
import type { ApprovalNotifier } from "../approval/notifier.js";
import type { SecretProvider } from "../secret/provider.js";
import { join } from "node:path";
import type { Logger } from "../observability/logger.js";
import { AgentRuntime } from "./runtime.js";
import type { PluginRegistry } from "../plugins/registry.js";
import type { PluginCatalogProvider } from "../plugins/catalog-provider.js";
import type { LanguageModel } from "ai";
import type { ProtocolDeps } from "../../ws/protocol.js";
import { isSharedStateMode } from "../runtime-state/mode.js";

function normalizeAgentId(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return "default";
  if (trimmed === "default") return "default";
  const parsed = AgentKey.safeParse(trimmed);
  if (!parsed.success) {
    throw new Error(`invalid agent_id '${trimmed}' (${parsed.error.message})`);
  }
  const normalized = parsed.data;
  if (/\s/.test(normalized)) {
    throw new Error(`invalid agent_id '${trimmed}' (agent ids must not contain whitespace)`);
  }
  if (normalized.includes("/") || normalized.includes("\\")) {
    throw new Error(`invalid agent_id '${trimmed}' (agent ids must not contain path separators)`);
  }
  if (normalized === "." || normalized === "..") {
    throw new Error(`invalid agent_id '${trimmed}' (agent ids must not be '.' or '..')`);
  }
  return normalized;
}

export class AgentRegistry {
  private readonly runtimeByAgentId = new Map<string, Promise<AgentRuntime>>();
  private readonly policyServiceByAgentId = new Map<string, PolicyService>();

  constructor(
    private readonly opts: {
      container: GatewayContainer;
      baseHome: string;
      secretProviderForTenant: (tenantId: string) => SecretProvider;
      defaultPolicyService: PolicyService;
      /** Optional global LanguageModel override (primarily for tests). */
      defaultLanguageModel?: LanguageModel;
      approvalNotifier: ApprovalNotifier;
      plugins?: PluginRegistry;
      pluginCatalogProvider?: PluginCatalogProvider;
      protocolDeps?: ProtocolDeps;
      logger: Logger;
    },
  ) {}

  resolveAgentHome(agentId: string): string {
    const id = normalizeAgentId(agentId);
    if (id === "default") return this.opts.baseHome;
    return join(this.opts.baseHome, "agents", id);
  }

  async listDiscoveredAgentKeys(): Promise<string[]> {
    if (isSharedStateMode(this.opts.container.deploymentConfig)) {
      return ["default"];
    }

    const keys = new Set<string>(["default"]);

    try {
      const entries = await readdir(join(this.opts.baseHome, "agents"), { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const parsed = AgentKey.safeParse(entry.name.trim());
        if (parsed.success) {
          keys.add(parsed.data);
        }
      }
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (((err as { code?: unknown }).code as string | undefined) === "ENOENT" ||
          ((err as { code?: unknown }).code as string | undefined) === "ENOTDIR")
      ) {
        return ["default"];
      }
      const message = err instanceof Error ? err.message : String(err);
      this.opts.logger.warn("agents.discovery_failed", {
        base_home: this.opts.baseHome,
        error: message,
      });
    }

    return Array.from(keys).toSorted((left, right) => {
      if (left === right) return 0;
      if (left === "default") return -1;
      if (right === "default") return 1;
      return left.localeCompare(right);
    });
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
      logger: this.opts.logger,
      deploymentPolicy: this.opts.container.deploymentConfig.policy,
      includeAgentHomeBundle: !isSharedStateMode(this.opts.container.deploymentConfig),
      configStore: this.opts.container.gatewayConfigStore,
    });
    this.policyServiceByAgentId.set(id, service);
    return service;
  }

  getSecretProvider(tenantId: string, agentId: string): SecretProvider {
    normalizeAgentId(agentId);
    return this.opts.secretProviderForTenant(tenantId);
  }

  private async resolvePluginsForTenant(tenantId: string): Promise<PluginRegistry | undefined> {
    return (
      (await this.opts.pluginCatalogProvider?.loadTenantRegistry(tenantId)) ?? this.opts.plugins
    );
  }

  private async refreshRuntimePlugins(
    runtime: AgentRuntime,
    tenantId: string,
    agentId: string,
  ): Promise<void> {
    try {
      const plugins = await this.resolvePluginsForTenant(tenantId);
      if (plugins) {
        runtime.setPlugins(plugins);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.logger.warn("agents.runtime_plugin_refresh_failed", {
        tenant_id: tenantId,
        agent_id: agentId,
        error: message,
      });
    }
  }

  async getRuntime(input: { tenantId: string; agentKey: string }): Promise<AgentRuntime> {
    const tenantId = input.tenantId.trim();
    const agentId = normalizeAgentId(input.agentKey);
    const cacheKey = `${tenantId}:${agentId}`;
    const existing = this.runtimeByAgentId.get(cacheKey);
    if (existing) {
      const runtime = await existing;
      await this.refreshRuntimePlugins(runtime, tenantId, agentId);
      return runtime;
    }

    const promise = (async () => {
      const home = this.resolveAgentHome(agentId);
      const secretProvider = this.getSecretProvider(tenantId, agentId);
      const policyService = this.getPolicyService(agentId);
      const plugins = await this.resolvePluginsForTenant(tenantId);

      const runtime = new AgentRuntime({
        container: this.opts.container,
        tenantId,
        home,
        fetchImpl: fetch,
        agentId,
        languageModel: this.opts.defaultLanguageModel,
        secretProvider,
        approvalNotifier: this.opts.approvalNotifier,
        plugins,
        policyService,
        protocolDeps: this.opts.protocolDeps,
      });

      this.opts.logger.info("agents.runtime_ready", {
        tenant_id: tenantId,
        agent_id: agentId,
        home,
      });

      return runtime;
    })().catch((err) => {
      this.runtimeByAgentId.delete(cacheKey);
      throw err;
    });

    this.runtimeByAgentId.set(cacheKey, promise);
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
