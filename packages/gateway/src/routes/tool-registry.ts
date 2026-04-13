import { McpServerSpec, type McpServerSpec as McpServerSpecT } from "@tyrum/contracts";
import type { PluginManifest as PluginManifestT } from "@tyrum/contracts";
import { Hono } from "hono";
import { BUILTIN_EXA_SERVER_ID } from "../app/modules/agent/builtin-exa.js";
import { McpManager } from "../app/modules/agent/mcp-manager.js";
import type { AgentRegistry } from "../app/modules/agent/registry.js";
import { RuntimePackageDal } from "../app/modules/agent/runtime-package-dal.js";
import {
  isBuiltinToolAvailableInStateMode,
  isToolAllowed,
  listBuiltinToolDescriptors,
  type ToolDescriptor,
} from "../app/modules/agent/tools.js";
import { validateToolDescriptorInputSchema } from "../app/modules/agent/tool-schema.js";
import { requireTenantId } from "../app/modules/auth/claims.js";
import {
  IdentityScopeDal,
  resolveRequestedAgentKey,
  ScopeNotFoundError,
} from "../app/modules/identity/scope.js";
import type { Logger } from "../app/modules/observability/logger.js";
import type { PluginCatalogProvider } from "../app/modules/plugins/catalog-provider.js";
import type { PluginRegistry } from "../app/modules/plugins/registry.js";
import type { GatewayStateMode } from "../app/modules/runtime-state/mode.js";
import type { SqlDb } from "../statestore/types.js";

type ToolEffectiveExposure = {
  enabled: boolean;
  reason:
    | "enabled"
    | "disabled_by_agent_allowlist"
    | "disabled_by_state_mode"
    | "disabled_invalid_schema";
  agent_key?: string;
};

type SharedStateMcpServerTools = {
  server: McpServerSpecT;
  descriptors: readonly ToolDescriptor[];
};

type ToolRegistryGroup =
  | "core"
  | "retrieval"
  | "environment"
  | "node"
  | "orchestration"
  | "extension";

type ToolRegistryEntry = {
  source: "builtin" | "builtin_mcp" | "mcp" | "plugin";
  canonical_id: string;
  description: string;
  effect: ToolDescriptor["effect"];
  effective_exposure: ToolEffectiveExposure;
  family?: string;
  group?: ToolRegistryGroup;
  keywords?: string[];
  input_schema?: Record<string, unknown>;
  backing_server?: {
    id: string;
    name: string;
    transport: string;
    url?: string;
  };
  plugin?: {
    id: string;
    name: string;
    version: string;
  };
};

export interface ToolRegistryRouteDeps {
  agents?: AgentRegistry;
  db: SqlDb;
  logger?: Logger;
  plugins?: PluginRegistry;
  pluginCatalogProvider?: PluginCatalogProvider;
  stateMode: GatewayStateMode;
}

async function resolvePluginRegistry(
  deps: ToolRegistryRouteDeps,
  tenantId: string,
): Promise<PluginRegistry | undefined> {
  if (deps.pluginCatalogProvider) {
    return await deps.pluginCatalogProvider.loadTenantRegistry(tenantId);
  }
  return deps.plugins;
}

function toBaseEntry(
  descriptor: ToolDescriptor,
  source: ToolRegistryEntry["source"],
  effectiveExposure: ToolEffectiveExposure,
): Omit<ToolRegistryEntry, "backing_server" | "plugin"> {
  const validatedSchema = validateToolDescriptorInputSchema(descriptor);
  return {
    source,
    canonical_id: descriptor.id,
    description: descriptor.description,
    effect: descriptor.effect,
    effective_exposure: effectiveExposure,
    family: descriptor.family,
    group: resolveToolGroup(descriptor, source),
    keywords: descriptor.keywords.length > 0 ? [...descriptor.keywords] : undefined,
    input_schema: validatedSchema.ok ? validatedSchema.schema : undefined,
  };
}

function resolveToolGroup(
  descriptor: ToolDescriptor,
  source: ToolRegistryEntry["source"],
): ToolRegistryGroup | undefined {
  if (source !== "builtin") return undefined;

  if (
    descriptor.family === "filesystem" ||
    descriptor.family === "shell" ||
    descriptor.family === "artifact"
  ) {
    return "core";
  }

  if (descriptor.family === "sandbox") {
    return "orchestration";
  }

  return undefined;
}

function toPluginEntry(
  descriptor: ToolDescriptor,
  plugin: PluginManifestT | undefined,
  effectiveExposure: ToolEffectiveExposure,
): ToolRegistryEntry {
  const base = toBaseEntry(descriptor, "plugin", effectiveExposure);
  return {
    source: base.source,
    canonical_id: base.canonical_id,
    description: base.description,
    effect: base.effect,
    effective_exposure: base.effective_exposure,
    family: base.family,
    group: base.group,
    keywords: base.keywords,
    input_schema: base.input_schema,
    plugin: toPluginInfo(plugin),
  };
}

function toBuiltinEntry(
  descriptor: ToolDescriptor,
  effectiveExposure: ToolEffectiveExposure,
): ToolRegistryEntry {
  const base = toBaseEntry(descriptor, descriptor.source ?? "builtin", effectiveExposure);
  return {
    source: base.source,
    canonical_id: base.canonical_id,
    description: base.description,
    effect: base.effect,
    effective_exposure: base.effective_exposure,
    family: base.family,
    group: base.group,
    keywords: base.keywords,
    input_schema: base.input_schema,
    backing_server: toBuiltinBackingServer(descriptor),
  };
}

function toBuiltinBackingServer(
  descriptor: ToolDescriptor,
): ToolRegistryEntry["backing_server"] | undefined {
  if (descriptor.source !== "builtin_mcp" || descriptor.backingServerId !== BUILTIN_EXA_SERVER_ID) {
    return undefined;
  }
  return {
    id: BUILTIN_EXA_SERVER_ID,
    name: "Exa",
    transport: "remote",
    url: "https://mcp.exa.ai/mcp",
  };
}

function toMcpBackingServer(server: McpServerSpecT): ToolRegistryEntry["backing_server"] {
  if (server.transport === "remote") {
    return {
      id: server.id,
      name: server.name,
      transport: server.transport,
      url: server.url,
    };
  }

  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
  };
}

function toPluginInfo(
  plugin: PluginManifestT | undefined,
): ToolRegistryEntry["plugin"] | undefined {
  if (!plugin) return undefined;
  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
  };
}

async function listSharedStateMcpServers(
  db: SqlDb,
  tenantId: string,
  logger?: Logger,
): Promise<McpServerSpecT[]> {
  const runtimePackageDal = new RuntimePackageDal(db);
  const revisions = await runtimePackageDal.listLatest({
    tenantId,
    packageKind: "mcp",
    enabledOnly: true,
  });
  const serversById = new Map<string, McpServerSpecT>();

  for (const revision of revisions) {
    const parsed = McpServerSpec.safeParse(revision.packageData);
    if (!parsed.success) {
      logger?.warn("tool_registry.invalid_mcp_package", {
        tenant_id: tenantId,
        package_key: revision.packageKey,
        revision: revision.revision,
        error: parsed.error.message,
      });
      continue;
    }
    if (!parsed.data.enabled) continue;
    serversById.set(parsed.data.id, parsed.data);
  }

  return [...serversById.values()].toSorted((a, b) => a.id.localeCompare(b.id));
}

function listMcpEntries(
  sharedStateMcpServerTools: readonly SharedStateMcpServerTools[],
  effectiveExposureByToolId: ReadonlyMap<string, ToolEffectiveExposure>,
): ToolRegistryEntry[] {
  return sharedStateMcpServerTools
    .flatMap(({ server, descriptors }) =>
      descriptors.map((descriptor) => ({
        ...toBaseEntry(
          descriptor,
          "mcp",
          effectiveExposureByToolId.get(descriptor.id) ?? { enabled: true, reason: "enabled" },
        ),
        backing_server: toMcpBackingServer(server),
      })),
    )
    .toSorted((a, b) => a.canonical_id.localeCompare(b.canonical_id));
}

async function listPluginEntries(
  deps: ToolRegistryRouteDeps,
  tenantId: string,
  effectiveExposureByToolId: ReadonlyMap<string, ToolEffectiveExposure>,
): Promise<ToolRegistryEntry[]> {
  const registry = await resolvePluginRegistry(deps, tenantId);
  if (!registry) return [];

  return registry
    .getToolDescriptors()
    .map((descriptor) =>
      toPluginEntry(
        descriptor,
        registry.getTool(descriptor.id)?.plugin,
        effectiveExposureByToolId.get(descriptor.id) ?? { enabled: true, reason: "enabled" },
      ),
    )
    .toSorted((a, b) => a.canonical_id.localeCompare(b.canonical_id));
}

async function resolveEffectiveExposureByToolId(input: {
  deps: ToolRegistryRouteDeps;
  tenantId: string;
  agentKey: string;
  sharedStateMcpServerTools?: readonly SharedStateMcpServerTools[];
}): Promise<ReadonlyMap<string, ToolEffectiveExposure>> {
  const effectiveExposureByToolId = new Map<string, ToolEffectiveExposure>();
  let allowlist: readonly string[] | undefined;

  if (input.deps.agents) {
    const runtime = await input.deps.agents.getRuntime({
      tenantId: input.tenantId,
      agentKey: input.agentKey,
    });
    allowlist = (await runtime.listRegisteredTools()).allowlist;
  }

  const setExposure = (descriptor: ToolDescriptor) => {
    const validated = validateToolDescriptorInputSchema(descriptor);
    if (!validated.ok) {
      effectiveExposureByToolId.set(descriptor.id, {
        enabled: false,
        reason: "disabled_invalid_schema",
        agent_key: input.agentKey,
      });
      return;
    }

    if (
      (descriptor.source === undefined || descriptor.source === "builtin") &&
      !isBuiltinToolAvailableInStateMode(descriptor.id, input.deps.stateMode)
    ) {
      effectiveExposureByToolId.set(descriptor.id, {
        enabled: false,
        reason: "disabled_by_state_mode",
        agent_key: input.agentKey,
      });
      return;
    }

    if (allowlist && !isToolAllowed(allowlist, descriptor.id)) {
      effectiveExposureByToolId.set(descriptor.id, {
        enabled: false,
        reason: "disabled_by_agent_allowlist",
        agent_key: input.agentKey,
      });
      return;
    }

    effectiveExposureByToolId.set(descriptor.id, {
      enabled: true,
      reason: "enabled",
      agent_key: input.agentKey,
    });
  };

  for (const descriptor of listBuiltinToolDescriptors()) {
    setExposure(descriptor);
  }

  const pluginRegistry = await resolvePluginRegistry(input.deps, input.tenantId);
  for (const descriptor of pluginRegistry?.getToolDescriptors() ?? []) {
    setExposure(descriptor);
  }

  const sharedStateMcpServerTools =
    input.sharedStateMcpServerTools ??
    (await (async (): Promise<SharedStateMcpServerTools[]> => {
      const mcpManager = new McpManager({ logger: input.deps.logger });
      try {
        return await listSharedStateMcpServerTools(
          input.deps.db,
          input.tenantId,
          mcpManager,
          input.deps.logger,
        );
      } finally {
        await mcpManager.shutdown();
      }
    })());

  for (const descriptor of sharedStateMcpServerTools.flatMap((entry) => entry.descriptors)) {
    setExposure(descriptor);
  }

  return effectiveExposureByToolId;
}

async function listSharedStateMcpServerTools(
  db: SqlDb,
  tenantId: string,
  mcpManager: McpManager,
  logger?: Logger,
): Promise<SharedStateMcpServerTools[]> {
  const servers = await listSharedStateMcpServers(db, tenantId, logger);
  if (servers.length === 0) return [];

  return await Promise.all(
    servers.map(async (server) => ({
      server,
      descriptors: await mcpManager.listServerToolDescriptors(server),
    })),
  );
}

export function createToolRegistryRoutes(deps: ToolRegistryRouteDeps): Hono {
  const app = new Hono();

  app.get("/config/tools", async (c) => {
    const tenantId = requireTenantId(c);
    let agentKey: string;
    try {
      agentKey = await resolveRequestedAgentKey({
        identityScopeDal: new IdentityScopeDal(deps.db),
        tenantId,
        agentKey: c.req.query("agent_key"),
      });
    } catch (error) {
      if (error instanceof ScopeNotFoundError) {
        return c.json({ error: error.code, message: error.message }, 404);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "invalid_request", message }, 400);
    }
    const mcpManager = new McpManager({ logger: deps.logger });
    try {
      const sharedStateMcpServerTools = await listSharedStateMcpServerTools(
        deps.db,
        tenantId,
        mcpManager,
        deps.logger,
      );
      const effectiveExposureByToolId = await resolveEffectiveExposureByToolId({
        deps,
        tenantId,
        agentKey,
        sharedStateMcpServerTools,
      });
      const builtinEntries = listBuiltinToolDescriptors()
        .map((descriptor) =>
          toBuiltinEntry(
            descriptor,
            effectiveExposureByToolId.get(descriptor.id) ?? { enabled: true, reason: "enabled" },
          ),
        )
        .toSorted((a, b) => a.canonical_id.localeCompare(b.canonical_id));
      const [pluginEntries, mcpEntries] = await Promise.all([
        listPluginEntries(deps, tenantId, effectiveExposureByToolId),
        Promise.resolve(listMcpEntries(sharedStateMcpServerTools, effectiveExposureByToolId)),
      ]);

      const tools = [...builtinEntries, ...pluginEntries, ...mcpEntries].toSorted((a, b) => {
        if (a.source !== b.source) return a.source.localeCompare(b.source);
        return a.canonical_id.localeCompare(b.canonical_id);
      });

      return c.json({ status: "ok", tools }, 200);
    } catch (error) {
      if (error instanceof ScopeNotFoundError) {
        return c.json({ error: error.code, message: error.message }, 404);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "invalid_request", message }, 400);
    } finally {
      await mcpManager.shutdown();
    }
  });

  return app;
}
