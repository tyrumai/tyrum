import { dirname, isAbsolute, resolve } from "node:path";
import {
  IdentityPack,
  type AgentConfig as AgentConfigT,
  type IdentityPack as IdentityPackT,
  type McpServerSpec as McpServerSpecT,
} from "@tyrum/contracts";
import { DEFAULT_IDENTITY_MD, resolveMcpDir } from "./home.js";
import { isAgentAccessAllowed } from "./access-config.js";
import { listMcpServersFromDir } from "./workspace.js";
import { parseFrontmatterDocument } from "./frontmatter.js";
import type { Logger } from "../observability/logger.js";
import {
  ensureManagedExtensionMaterialized,
  parseManagedMcpPackage,
} from "../extensions/managed.js";
import { buildBuiltinMemoryServerSpec } from "../memory/builtin-mcp.js";
import type { RuntimePackageDal } from "./runtime-package-dal.js";

function normalizeManagedMcpSpec(
  spec: McpServerSpecT,
  materializedPath: string | undefined,
): McpServerSpecT {
  if (spec.transport !== "stdio" || !materializedPath) {
    return spec;
  }
  const bundleDir = dirname(materializedPath);
  if (!spec.cwd) {
    return { ...spec, cwd: bundleDir };
  }
  if (isAbsolute(spec.cwd)) {
    return spec;
  }
  return { ...spec, cwd: resolve(bundleDir, spec.cwd) };
}

export function parseDefaultIdentity(): IdentityPackT {
  const parsed = parseFrontmatterDocument(DEFAULT_IDENTITY_MD);
  return IdentityPack.parse({
    meta: parsed.frontmatter,
  });
}

export async function loadLocalEnabledMcpServers(params: {
  tenantId: string;
  agentId: string;
  home: string;
  logger: Logger | undefined;
  config: AgentConfigT;
  runtimePackageDal: RuntimePackageDal;
}): Promise<McpServerSpecT[]> {
  const builtinMemoryServer = buildBuiltinMemoryServerSpec();
  const managedServers = await params.runtimePackageDal.listLatest({
    tenantId: params.tenantId,
    packageKind: "mcp",
    enabledOnly: true,
  });
  const managedById = new Map(managedServers.map((item) => [item.packageKey, item]));
  const localServers = await listMcpServersFromDir(resolveMcpDir(params.home), params.logger);
  const localById = new Map(localServers.map((item) => [item.id, item]));
  const loaded: McpServerSpecT[] = [];
  const seen = new Set<string>();

  for (const serverId of [
    builtinMemoryServer.id,
    ...localServers.map((server) => server.id),
    ...managedServers.map((server) => server.packageKey),
  ]) {
    const normalizedServerId = serverId.trim();
    if (
      normalizedServerId.length === 0 ||
      seen.has(normalizedServerId) ||
      !isAgentAccessAllowed(params.config.mcp, normalizedServerId)
    ) {
      continue;
    }
    seen.add(normalizedServerId);

    if (normalizedServerId === builtinMemoryServer.id) {
      loaded.push(builtinMemoryServer);
      continue;
    }

    const local = localById.get(normalizedServerId);
    if (local) {
      loaded.push(local);
      continue;
    }

    const managed = managedById.get(normalizedServerId);
    if (!managed) continue;
    try {
      const pkg = parseManagedMcpPackage(managed.packageData, normalizedServerId);
      const materializedPath = await ensureManagedExtensionMaterialized({
        home: params.home,
        tenantId: params.tenantId,
        stateMode: "local",
        kind: "mcp",
        revision: managed,
      });
      const spec = normalizeManagedMcpSpec(pkg.spec, materializedPath);
      loaded.push(spec.id === normalizedServerId ? spec : { ...spec, id: normalizedServerId });
    } catch (error) {
      params.logger?.warn("agent.managed_mcp_invalid", {
        tenant_id: params.tenantId,
        agent_id: params.agentId,
        server_id: normalizedServerId,
        revision: managed.revision,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return loaded;
}

export async function loadSharedEnabledMcpServers(params: {
  tenantId: string;
  agentId: string;
  home: string;
  logger: Logger | undefined;
  config: AgentConfigT;
  runtimePackageDal: RuntimePackageDal;
}): Promise<McpServerSpecT[]> {
  const builtinMemoryServer = buildBuiltinMemoryServerSpec();
  const sharedServers = await params.runtimePackageDal.listLatest({
    tenantId: params.tenantId,
    packageKind: "mcp",
    enabledOnly: true,
  });
  const sharedById = new Map(sharedServers.map((item) => [item.packageKey, item]));
  const loaded: McpServerSpecT[] = [];
  const seen = new Set<string>();

  for (const serverId of [
    builtinMemoryServer.id,
    ...sharedServers.map((server) => server.packageKey),
  ]) {
    const normalizedServerId = serverId.trim();
    if (
      normalizedServerId.length === 0 ||
      seen.has(normalizedServerId) ||
      !isAgentAccessAllowed(params.config.mcp, normalizedServerId)
    ) {
      continue;
    }
    seen.add(normalizedServerId);

    if (normalizedServerId === builtinMemoryServer.id) {
      loaded.push(builtinMemoryServer);
      continue;
    }

    const shared = sharedById.get(normalizedServerId);
    if (!shared) continue;
    try {
      const pkg = parseManagedMcpPackage(shared.packageData, normalizedServerId);
      const materializedPath = await ensureManagedExtensionMaterialized({
        home: params.home,
        tenantId: params.tenantId,
        stateMode: "shared",
        kind: "mcp",
        revision: shared,
      });
      const spec = normalizeManagedMcpSpec(pkg.spec, materializedPath);
      loaded.push(spec.id === normalizedServerId ? spec : { ...spec, id: normalizedServerId });
    } catch (error) {
      params.logger?.warn("agent.shared_mcp_invalid", {
        tenant_id: params.tenantId,
        agent_id: params.agentId,
        server_id: normalizedServerId,
        revision: shared.revision,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return loaded;
}
