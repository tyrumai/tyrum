import { type McpServerSpec as McpServerSpecT, type ToolTaxonomyMetadata } from "@tyrum/contracts";
import type { PluginManifest as PluginManifestT } from "@tyrum/contracts";
import { Hono } from "hono";
import { BUILTIN_EXA_SERVER_ID } from "../app/modules/agent/builtin-exa.js";
import type { AgentRegistry } from "../app/modules/agent/registry.js";
import type {
  EffectiveToolExposureReason,
  EffectiveToolExposureVerdict,
} from "../app/modules/agent/runtime/effective-exposure-resolver.js";
import { validateToolDescriptorInputSchema } from "../app/modules/agent/tool-schema.js";
import { resolveToolDescriptorTaxonomy, type ToolDescriptor } from "../app/modules/agent/tools.js";
import { requireTenantId } from "../app/modules/auth/claims.js";
import {
  IdentityScopeDal,
  resolveRequestedAgentKey,
  ScopeNotFoundError,
} from "../app/modules/identity/scope.js";
import type { PluginCatalogProvider } from "../app/modules/plugins/catalog-provider.js";
import type { PluginRegistry } from "../app/modules/plugins/registry.js";
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

type ToolRegistryGroup =
  | "core"
  | "retrieval"
  | "environment"
  | "node"
  | "orchestration"
  | "extension";

type ToolRegistryTier = "default" | "advanced";

type ToolRegistryEntry = {
  source: "builtin" | "builtin_mcp" | "mcp" | "plugin";
  canonical_id: string;
  description: string;
  effect: ToolDescriptor["effect"];
  effective_exposure: ToolEffectiveExposure;
  family?: string;
  group?: ToolRegistryGroup;
  tier?: ToolRegistryTier;
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

type RegisteredToolsCatalog = Awaited<
  ReturnType<Awaited<ReturnType<AgentRegistry["getRuntime"]>>["listRegisteredTools"]>
>;

type RuntimeToolInventoryCatalog = {
  inventory: readonly EffectiveToolExposureVerdict[];
  mcpServerSpecs: readonly McpServerSpecT[];
};

export interface ToolRegistryRouteDeps {
  agents?: AgentRegistry;
  db: SqlDb;
  plugins?: PluginRegistry;
  pluginCatalogProvider?: PluginCatalogProvider;
}

function isInvalidRequestError(error: unknown): error is Error & { code: "invalid_request" } {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "invalid_request"
  );
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

function hasRuntimeToolInventoryCatalog(
  value: RegisteredToolsCatalog,
): value is RegisteredToolsCatalog & RuntimeToolInventoryCatalog {
  return (
    Array.isArray((value as { inventory?: unknown }).inventory) &&
    Array.isArray((value as { mcpServerSpecs?: unknown }).mcpServerSpecs)
  );
}

function resolveDescriptorTaxonomy(
  descriptor: ToolDescriptor,
  source: ToolRegistryEntry["source"],
): ToolTaxonomyMetadata {
  return descriptor.taxonomy ?? resolveToolDescriptorTaxonomy({ ...descriptor, source });
}

function toBaseEntry(
  descriptor: ToolDescriptor,
  source: ToolRegistryEntry["source"],
  effectiveExposure: ToolEffectiveExposure,
): Omit<ToolRegistryEntry, "backing_server" | "plugin"> {
  const taxonomy = resolveDescriptorTaxonomy(descriptor, source);
  const validatedSchema = validateToolDescriptorInputSchema(descriptor);
  return {
    source,
    canonical_id: descriptor.id,
    description: descriptor.description,
    effect: descriptor.effect,
    effective_exposure: effectiveExposure,
    family: descriptor.family,
    group: resolveToolGroup(source, taxonomy),
    tier: resolveToolTier(source, taxonomy),
    keywords: descriptor.keywords.length > 0 ? [...descriptor.keywords] : undefined,
    input_schema: validatedSchema.ok ? validatedSchema.schema : undefined,
  };
}

function resolveToolGroup(
  source: ToolRegistryEntry["source"],
  taxonomy: ToolTaxonomyMetadata,
): ToolRegistryGroup | undefined {
  if (source === "builtin_mcp" && taxonomy.group === "retrieval") {
    return taxonomy.group;
  }

  if (source === "builtin" && taxonomy.group) {
    if (taxonomy.group === "core") {
      return taxonomy.group;
    }
    if (taxonomy.group === "environment") {
      return taxonomy.group;
    }
    if (taxonomy.group === "orchestration" && taxonomy.family === "sandbox") {
      return taxonomy.group;
    }
  }

  return undefined;
}

function resolveToolTier(
  source: ToolRegistryEntry["source"],
  taxonomy: ToolTaxonomyMetadata,
): ToolRegistryTier | undefined {
  if (source === "builtin_mcp" && taxonomy.group === "retrieval" && taxonomy.tier === "default") {
    return taxonomy.tier;
  }

  if (source === "builtin" && taxonomy.group === "environment" && taxonomy.tier === "advanced") {
    return taxonomy.tier;
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
    tier: base.tier,
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
    tier: base.tier,
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

function mapEffectiveExposureReason(
  reason: EffectiveToolExposureReason,
): ToolEffectiveExposure["reason"] {
  switch (reason) {
    case "enabled":
      return "enabled";
    case "disabled_by_state_mode":
      return "disabled_by_state_mode";
    case "disabled_invalid_schema":
      return "disabled_invalid_schema";
    default:
      return "disabled_by_agent_allowlist";
  }
}

function toToolEffectiveExposure(
  verdict: EffectiveToolExposureVerdict,
  agentKey: string,
): ToolEffectiveExposure {
  return {
    enabled: verdict.enabled,
    reason: mapEffectiveExposureReason(verdict.reason),
    agent_key: agentKey,
  };
}

function listBuiltinEntries(
  verdicts: readonly EffectiveToolExposureVerdict[],
  agentKey: string,
): ToolRegistryEntry[] {
  return verdicts
    .filter((verdict) => verdict.exposureClass !== "mcp" && verdict.exposureClass !== "plugin")
    .map((verdict) =>
      toBuiltinEntry(verdict.descriptor, toToolEffectiveExposure(verdict, agentKey)),
    )
    .toSorted((left, right) => left.canonical_id.localeCompare(right.canonical_id));
}

function listPluginEntries(
  registry: PluginRegistry | undefined,
  verdicts: readonly EffectiveToolExposureVerdict[],
  agentKey: string,
): ToolRegistryEntry[] {
  return verdicts
    .filter((verdict) => verdict.exposureClass === "plugin")
    .map((verdict) =>
      toPluginEntry(
        verdict.descriptor,
        registry?.getTool(verdict.descriptor.id)?.plugin,
        toToolEffectiveExposure(verdict, agentKey),
      ),
    )
    .toSorted((left, right) => left.canonical_id.localeCompare(right.canonical_id));
}

function listMcpEntries(
  verdicts: readonly EffectiveToolExposureVerdict[],
  mcpServersById: ReadonlyMap<string, McpServerSpecT>,
  agentKey: string,
): ToolRegistryEntry[] {
  return verdicts
    .filter((verdict) => verdict.exposureClass === "mcp")
    .map((verdict) => {
      const descriptor = verdict.descriptor;
      const backingServerId = descriptor.backingServerId ?? descriptor.id.split(".")[1];
      const server = backingServerId ? mcpServersById.get(backingServerId) : undefined;
      const base = toBaseEntry(descriptor, "mcp", toToolEffectiveExposure(verdict, agentKey));

      return {
        source: base.source,
        canonical_id: base.canonical_id,
        description: base.description,
        effect: base.effect,
        effective_exposure: base.effective_exposure,
        family: base.family,
        group: base.group,
        tier: base.tier,
        keywords: base.keywords,
        input_schema: base.input_schema,
        backing_server: server ? toMcpBackingServer(server) : undefined,
      };
    })
    .toSorted((left, right) => left.canonical_id.localeCompare(right.canonical_id));
}

function resolveInventoryToolEntries(params: {
  catalog: RuntimeToolInventoryCatalog;
  pluginRegistry: PluginRegistry | undefined;
  agentKey: string;
}): ToolRegistryEntry[] {
  const mcpServersById = new Map(
    params.catalog.mcpServerSpecs.map((server) => [server.id, server] as const),
  );

  return [
    ...listBuiltinEntries(params.catalog.inventory, params.agentKey),
    ...listPluginEntries(params.pluginRegistry, params.catalog.inventory, params.agentKey),
    ...listMcpEntries(params.catalog.inventory, mcpServersById, params.agentKey),
  ].toSorted((left, right) => {
    if (left.source !== right.source) {
      return left.source.localeCompare(right.source);
    }
    return left.canonical_id.localeCompare(right.canonical_id);
  });
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

    try {
      if (!deps.agents) {
        throw new Error("agent registry is unavailable");
      }
      const runtime = await deps.agents.getRuntime({ tenantId, agentKey });
      const catalog = await runtime.listRegisteredTools();
      if (!hasRuntimeToolInventoryCatalog(catalog)) {
        throw new Error("runtime tool inventory is unavailable");
      }
      const pluginRegistry = await resolvePluginRegistry(deps, tenantId);
      const tools = resolveInventoryToolEntries({
        catalog,
        pluginRegistry,
        agentKey,
      });

      return c.json({ status: "ok", tools }, 200);
    } catch (error) {
      if (isInvalidRequestError(error)) {
        return c.json({ error: "invalid_request", message: error.message }, 400);
      }
      if (error instanceof ScopeNotFoundError) {
        return c.json({ error: error.code, message: error.message }, 404);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "internal_error", message }, 500);
    }
  });

  return app;
}
