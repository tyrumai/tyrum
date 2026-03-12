import type {
  AgentMcpCapability as AgentMcpCapabilityT,
  AgentSkillCapability as AgentSkillCapabilityT,
  AgentToolCapability as AgentToolCapabilityT,
  AgentConfig as AgentConfigT,
} from "@tyrum/schemas";
import type { GatewayStateMode } from "../runtime-state/mode.js";
import { RuntimePackageDal } from "./runtime-package-dal.js";
import { parseManagedMcpPackage, parseManagedSkillPackage } from "../extensions/managed.js";
import {
  resolveAgentHome,
  resolveBundledSkillsDir,
  resolveMcpDir,
  resolveSkillsDir,
  resolveUserSkillsDir,
} from "./home.js";
import { listMcpServersFromDir, listSkillsFromDir } from "./workspace.js";
import { isBuiltinToolAvailableInStateMode, listBuiltinToolDescriptors } from "./tools.js";
import { McpManager } from "./mcp-manager.js";
import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";
import type { PluginCatalogProvider } from "../plugins/catalog-provider.js";
import type { PluginRegistry } from "../plugins/registry.js";

function upsertCapability<T extends { id: string }>(itemsById: Map<string, T>, item: T): void {
  if (!itemsById.has(item.id)) {
    itemsById.set(item.id, item);
  }
}

function sortCapabilities<T extends { id: string }>(itemsById: Map<string, T>): T[] {
  return [...itemsById.values()].toSorted((left, right) => left.id.localeCompare(right.id));
}

async function resolvePluginRegistry(
  tenantId: string,
  pluginCatalogProvider?: PluginCatalogProvider,
  plugins?: PluginRegistry,
): Promise<PluginRegistry | undefined> {
  if (pluginCatalogProvider) {
    return await pluginCatalogProvider.loadTenantRegistry(tenantId);
  }
  return plugins;
}

export async function listAgentSkillCapabilities(params: {
  db: SqlDb;
  tenantId: string;
  agentKey: string;
  stateMode: GatewayStateMode;
  logger?: Logger;
}): Promise<AgentSkillCapabilityT[]> {
  const runtimePackageDal = new RuntimePackageDal(params.db);
  const itemsById = new Map<string, AgentSkillCapabilityT>();
  const bundledSkillsDir = resolveBundledSkillsDir();

  if (params.stateMode === "local") {
    const workspaceSkills = await listSkillsFromDir(
      resolveSkillsDir(resolveAgentHome(undefined, params.agentKey)),
      "workspace",
      params.logger,
    );
    for (const skill of workspaceSkills) {
      upsertCapability(itemsById, {
        id: skill.meta.id,
        name: skill.meta.name,
        version: skill.meta.version,
        source: "workspace",
      });
    }

    const managedSkills = await runtimePackageDal.listLatest({
      tenantId: params.tenantId,
      packageKind: "skill",
      enabledOnly: true,
    });
    for (const skill of managedSkills) {
      try {
        const parsed = parseManagedSkillPackage(skill.packageData, skill.packageKey);
        upsertCapability(itemsById, {
          id: skill.packageKey,
          name: parsed.manifest.meta.name,
          version: parsed.manifest.meta.version,
          source: "managed",
        });
      } catch {
        // Intentional: capability discovery ignores invalid managed skill packages just like runtime loading.
      }
    }

    const userSkills = await listSkillsFromDir(resolveUserSkillsDir(), "user", params.logger);
    for (const skill of userSkills) {
      upsertCapability(itemsById, {
        id: skill.meta.id,
        name: skill.meta.name,
        version: skill.meta.version,
        source: "user",
      });
    }
  } else {
    const sharedSkills = await runtimePackageDal.listLatest({
      tenantId: params.tenantId,
      packageKind: "skill",
      enabledOnly: true,
    });
    for (const skill of sharedSkills) {
      try {
        const parsed = parseManagedSkillPackage(skill.packageData, skill.packageKey);
        upsertCapability(itemsById, {
          id: skill.packageKey,
          name: parsed.manifest.meta.name,
          version: parsed.manifest.meta.version,
          source: "shared",
        });
      } catch {
        // Intentional: capability discovery ignores invalid shared skill packages just like runtime loading.
      }
    }
  }

  const bundledSkills = await listSkillsFromDir(bundledSkillsDir, "bundled", params.logger);
  for (const skill of bundledSkills) {
    upsertCapability(itemsById, {
      id: skill.meta.id,
      name: skill.meta.name,
      version: skill.meta.version,
      source: "bundled",
    });
  }

  return sortCapabilities(itemsById);
}

export async function listAgentMcpCapabilities(params: {
  db: SqlDb;
  tenantId: string;
  agentKey: string;
  stateMode: GatewayStateMode;
  logger?: Logger;
}): Promise<AgentMcpCapabilityT[]> {
  const runtimePackageDal = new RuntimePackageDal(params.db);
  const itemsById = new Map<string, AgentMcpCapabilityT>();

  if (params.stateMode === "local") {
    const workspaceMcpServers = await listMcpServersFromDir(
      resolveMcpDir(resolveAgentHome(undefined, params.agentKey)),
      params.logger,
    );
    for (const server of workspaceMcpServers) {
      upsertCapability(itemsById, {
        id: server.id,
        name: server.name,
        transport: server.transport,
        source: "workspace",
      });
    }

    const managedServers = await runtimePackageDal.listLatest({
      tenantId: params.tenantId,
      packageKind: "mcp",
      enabledOnly: true,
    });
    for (const server of managedServers) {
      try {
        const parsed = parseManagedMcpPackage(server.packageData, server.packageKey);
        upsertCapability(itemsById, {
          id: server.packageKey,
          name: parsed.spec.name,
          transport: parsed.spec.transport,
          source: "managed",
        });
      } catch {
        // Intentional: capability discovery ignores invalid managed MCP packages just like runtime loading.
      }
    }
  } else {
    const sharedServers = await runtimePackageDal.listLatest({
      tenantId: params.tenantId,
      packageKind: "mcp",
      enabledOnly: true,
    });
    for (const server of sharedServers) {
      try {
        const parsed = parseManagedMcpPackage(server.packageData, server.packageKey);
        upsertCapability(itemsById, {
          id: server.packageKey,
          name: parsed.spec.name,
          transport: parsed.spec.transport,
          source: "shared",
        });
      } catch {
        // Intentional: capability discovery ignores invalid shared MCP packages just like runtime loading.
      }
    }
  }

  return sortCapabilities(itemsById);
}

export async function listAgentToolCapabilities(params: {
  db: SqlDb;
  tenantId: string;
  agentKey: string;
  stateMode: GatewayStateMode;
  logger?: Logger;
  pluginCatalogProvider?: PluginCatalogProvider;
  plugins?: PluginRegistry;
}): Promise<AgentToolCapabilityT[]> {
  const itemsById = new Map<string, AgentToolCapabilityT>();

  for (const tool of listBuiltinToolDescriptors()) {
    if (!isBuiltinToolAvailableInStateMode(tool.id, params.stateMode)) continue;
    upsertCapability(itemsById, {
      id: tool.id,
      description: tool.description,
      source: tool.source ?? "builtin",
      family: tool.family ?? null,
      backing_server_id: tool.backingServerId ?? null,
    });
  }

  const mcpManager = new McpManager({ logger: params.logger });
  try {
    const mcpServers = await listAgentMcpCapabilities(params);
    const discoverableServerIds = new Set(mcpServers.map((server) => server.id));
    const runtimePackageDal = new RuntimePackageDal(params.db);
    const sharedOrManagedServers = await runtimePackageDal.listLatest({
      tenantId: params.tenantId,
      packageKind: "mcp",
      enabledOnly: true,
    });
    const localServers =
      params.stateMode === "local"
        ? await listMcpServersFromDir(
            resolveMcpDir(resolveAgentHome(undefined, params.agentKey)),
            params.logger,
          )
        : [];

    const serverSpecs = [
      ...localServers.filter((server) => discoverableServerIds.has(server.id)),
      ...sharedOrManagedServers.flatMap((server) => {
        if (!discoverableServerIds.has(server.packageKey)) return [];
        try {
          return [parseManagedMcpPackage(server.packageData, server.packageKey).spec];
        } catch {
          // Intentional: invalid managed MCP packages are skipped from discovery so one bad package does not block the catalog.
          return [];
        }
      }),
    ];

    const mcpTools = await mcpManager.listToolDescriptors(serverSpecs);
    for (const tool of mcpTools) {
      upsertCapability(itemsById, {
        id: tool.id,
        description: tool.description,
        source: tool.source ?? "mcp",
        family: tool.family ?? null,
        backing_server_id: tool.backingServerId ?? null,
      });
    }
  } finally {
    await mcpManager.shutdown();
  }

  const registry = await resolvePluginRegistry(
    params.tenantId,
    params.pluginCatalogProvider,
    params.plugins,
  );
  for (const tool of registry?.getToolDescriptors() ?? []) {
    upsertCapability(itemsById, {
      id: tool.id,
      description: tool.description,
      source: tool.source ?? "plugin",
      family: tool.family ?? null,
      backing_server_id: tool.backingServerId ?? null,
    });
  }

  return sortCapabilities(itemsById);
}

export async function listAgentCapabilities(params: {
  config: AgentConfigT;
  db: SqlDb;
  tenantId: string;
  agentKey: string;
  stateMode: GatewayStateMode;
  logger?: Logger;
  pluginCatalogProvider?: PluginCatalogProvider;
  plugins?: PluginRegistry;
}) {
  const [skills, mcp, tools] = await Promise.all([
    listAgentSkillCapabilities(params),
    listAgentMcpCapabilities(params),
    listAgentToolCapabilities(params),
  ]);

  return {
    skills: {
      default_mode: params.config.skills.default_mode,
      allow: [...params.config.skills.allow],
      deny: [...params.config.skills.deny],
      workspace_trusted: params.config.skills.workspace_trusted,
      items: skills,
    },
    mcp: {
      default_mode: params.config.mcp.default_mode,
      allow: [...params.config.mcp.allow],
      deny: [...params.config.mcp.deny],
      items: mcp,
    },
    tools: {
      default_mode: params.config.tools.default_mode,
      allow: [...params.config.tools.allow],
      deny: [...params.config.tools.deny],
      items: tools,
    },
  };
}
