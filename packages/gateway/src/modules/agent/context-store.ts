import { dirname, isAbsolute, resolve } from "node:path";
import type {
  AgentConfig as AgentConfigT,
  IdentityPack as IdentityPackT,
  McpServerSpec as McpServerSpecT,
} from "@tyrum/schemas";
import { IdentityPack } from "@tyrum/schemas";
import {
  ensureWorkspaceInitialized,
  DEFAULT_IDENTITY_MD,
  resolveBundledSkillsDir,
  resolveMcpDir,
  resolveSkillsDir,
  resolveUserSkillsDir,
} from "./home.js";
import { AgentIdentityDal } from "./identity-dal.js";
import { RuntimePackageDal } from "./runtime-package-dal.js";
import { isAgentAccessAllowed } from "./access-config.js";
import {
  listMcpServersFromDir,
  listSkillsFromDir,
  loadSkillFromDir,
  type LoadedSkillManifest,
} from "./workspace.js";
import { parseFrontmatterDocument } from "./frontmatter.js";
import type { Logger } from "../observability/logger.js";
import type { SqlDb } from "../../statestore/types.js";
import type { IdentityScopeDal } from "../identity/scope.js";
import { resolveGatewayStateMode } from "../runtime-state/mode.js";
import type { GatewayContainer } from "../../container.js";
import {
  ensureManagedExtensionMaterialized,
  parseManagedMcpPackage,
  parseManagedSkillPackage,
} from "../extensions/managed.js";
import { buildBuiltinMemoryServerSpec } from "../memory/builtin-mcp.js";

export interface AgentContextScope {
  tenantId: string;
  agentId: string;
  workspaceId: string;
}

export interface AgentContextStore {
  ensureAgentContext(scope: AgentContextScope): Promise<void>;
  getIdentity(scope: AgentContextScope): Promise<IdentityPackT>;
  getEnabledSkills(scope: AgentContextScope, config: AgentConfigT): Promise<LoadedSkillManifest[]>;
  getEnabledMcpServers(scope: AgentContextScope, config: AgentConfigT): Promise<McpServerSpecT[]>;
}

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

class LocalAgentContextStore implements AgentContextStore {
  private readonly identityDal: AgentIdentityDal;
  private readonly runtimePackageDal: RuntimePackageDal;

  constructor(
    private readonly db: SqlDb,
    private readonly home: string,
    private readonly identityScopeDal: IdentityScopeDal,
    private readonly logger?: Logger,
  ) {
    this.identityDal = new AgentIdentityDal(db);
    this.runtimePackageDal = new RuntimePackageDal(db);
  }

  private async resolveScopeIds(scope: AgentContextScope): Promise<AgentContextScope> {
    const resolvedAgentRow = await this.db.get<{ agent_id: string }>(
      `SELECT agent_id
       FROM agents
       WHERE tenant_id = ? AND agent_id = ?
       LIMIT 1`,
      [scope.tenantId, scope.agentId],
    );
    const resolvedWorkspaceRow = await this.db.get<{ workspace_id: string }>(
      `SELECT workspace_id
       FROM workspaces
       WHERE tenant_id = ? AND workspace_id = ?
       LIMIT 1`,
      [scope.tenantId, scope.workspaceId],
    );

    return {
      tenantId: scope.tenantId,
      agentId:
        resolvedAgentRow?.agent_id ??
        (await this.identityScopeDal.ensureAgentId(scope.tenantId, scope.agentId)),
      workspaceId:
        resolvedWorkspaceRow?.workspace_id ??
        (await this.identityScopeDal.ensureWorkspaceId(scope.tenantId, scope.workspaceId)),
    };
  }

  private async ensureScopeRows(scope: AgentContextScope): Promise<AgentContextScope> {
    await this.db.run(
      `INSERT INTO tenants (tenant_id, tenant_key)
       VALUES (?, ?)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [scope.tenantId, scope.tenantId],
    );
    const resolved = await this.resolveScopeIds(scope);
    await this.db.run(
      `INSERT INTO agents (tenant_id, agent_id, agent_key)
       VALUES (?, ?, ?)
       ON CONFLICT (tenant_id, agent_id) DO NOTHING`,
      [resolved.tenantId, resolved.agentId, resolved.agentId],
    );
    await this.db.run(
      `INSERT INTO workspaces (tenant_id, workspace_id, workspace_key)
       VALUES (?, ?, ?)
       ON CONFLICT (tenant_id, workspace_id) DO NOTHING`,
      [resolved.tenantId, resolved.workspaceId, resolved.workspaceId],
    );
    await this.db.run(
      `INSERT INTO agent_workspaces (tenant_id, agent_id, workspace_id)
       VALUES (?, ?, ?)
       ON CONFLICT (tenant_id, agent_id, workspace_id) DO NOTHING`,
      [resolved.tenantId, resolved.agentId, resolved.workspaceId],
    );
    return resolved;
  }

  private async ensureIdentity(scope: AgentContextScope): Promise<IdentityPackT> {
    const resolved = await this.ensureScopeRows(scope);
    const revision = await this.identityDal.ensureSeeded({
      tenantId: resolved.tenantId,
      agentId: resolved.agentId,
      defaultIdentity: parseDefaultIdentity(),
      createdBy: { kind: "agent-runtime" },
      reason: "seed",
    });
    return revision.identity;
  }

  async ensureAgentContext(scope: AgentContextScope): Promise<void> {
    await ensureWorkspaceInitialized(this.home);
    await this.ensureIdentity(scope);
  }

  async getIdentity(scope: AgentContextScope): Promise<IdentityPackT> {
    return await this.ensureIdentity(scope);
  }

  async getEnabledSkills(
    scope: AgentContextScope,
    config: AgentConfigT,
  ): Promise<LoadedSkillManifest[]> {
    const managedSkills = await this.runtimePackageDal.listLatest({
      tenantId: scope.tenantId,
      packageKind: "skill",
      enabledOnly: true,
    });
    const managedById = new Map(managedSkills.map((item) => [item.packageKey, item]));
    const workspaceSkillsDir = resolveSkillsDir(this.home);
    const userSkillsDir = resolveUserSkillsDir();
    const bundledSkillsDir = resolveBundledSkillsDir();
    const workspaceTrusted = config.skills.workspace_trusted === true;
    const orderedSkillIds = [
      ...(workspaceTrusted
        ? (await listSkillsFromDir(workspaceSkillsDir, "workspace", this.logger)).map(
            (skill) => skill.meta.id,
          )
        : []),
      ...managedSkills.map((skill) => skill.packageKey),
      ...(await listSkillsFromDir(userSkillsDir, "user", this.logger)).map(
        (skill) => skill.meta.id,
      ),
      ...(await listSkillsFromDir(bundledSkillsDir, "bundled", this.logger)).map(
        (skill) => skill.meta.id,
      ),
    ];
    const loaded: LoadedSkillManifest[] = [];
    const seen = new Set<string>();

    for (const skillId of orderedSkillIds) {
      const normalizedSkillId = skillId.trim();
      if (
        normalizedSkillId.length === 0 ||
        seen.has(normalizedSkillId) ||
        !isAgentAccessAllowed(config.skills, normalizedSkillId)
      ) {
        continue;
      }
      seen.add(normalizedSkillId);

      const workspaceSkill = workspaceTrusted
        ? await loadSkillFromDir(workspaceSkillsDir, normalizedSkillId, "workspace", this.logger)
        : undefined;
      if (workspaceSkill) {
        loaded.push(workspaceSkill);
        continue;
      }

      const managed = managedById.get(normalizedSkillId);
      if (managed) {
        try {
          const pkg = parseManagedSkillPackage(managed.packageData, normalizedSkillId);
          const materializedPath = await ensureManagedExtensionMaterialized({
            home: this.home,
            tenantId: scope.tenantId,
            stateMode: "local",
            kind: "skill",
            revision: managed,
          });
          loaded.push({
            ...pkg.manifest,
            provenance: {
              source: "managed",
              path:
                materializedPath ??
                `db://runtime-packages/skill/${normalizedSkillId}@${managed.revision}`,
            },
          });
          continue;
        } catch (error) {
          this.logger?.warn("agent.managed_skill_invalid", {
            tenant_id: scope.tenantId,
            agent_id: scope.agentId,
            skill_id: normalizedSkillId,
            revision: managed.revision,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const fallback =
        (await loadSkillFromDir(userSkillsDir, normalizedSkillId, "user", this.logger)) ??
        (await loadSkillFromDir(bundledSkillsDir, normalizedSkillId, "bundled", this.logger));
      if (fallback) loaded.push(fallback);
    }

    return loaded;
  }

  async getEnabledMcpServers(
    scope: AgentContextScope,
    config: AgentConfigT,
  ): Promise<McpServerSpecT[]> {
    const managedServers = await this.runtimePackageDal.listLatest({
      tenantId: scope.tenantId,
      packageKind: "mcp",
      enabledOnly: true,
    });
    const managedById = new Map(managedServers.map((item) => [item.packageKey, item]));
    const localServers = await listMcpServersFromDir(resolveMcpDir(this.home), this.logger);
    const localById = new Map(localServers.map((item) => [item.id, item]));
    const loaded: McpServerSpecT[] = [];
    const seen = new Set<string>();
    const orderedServerIds = [
      buildBuiltinMemoryServerSpec().id,
      ...localServers.map((server) => server.id),
      ...managedServers.map((server) => server.packageKey),
    ];

    for (const serverId of orderedServerIds) {
      const normalizedServerId = serverId.trim();
      if (
        normalizedServerId.length === 0 ||
        seen.has(normalizedServerId) ||
        !isAgentAccessAllowed(config.mcp, normalizedServerId)
      ) {
        continue;
      }
      seen.add(normalizedServerId);

      if (normalizedServerId === buildBuiltinMemoryServerSpec().id) {
        loaded.push(buildBuiltinMemoryServerSpec());
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
          home: this.home,
          tenantId: scope.tenantId,
          stateMode: "local",
          kind: "mcp",
          revision: managed,
        });
        const spec = normalizeManagedMcpSpec(pkg.spec, materializedPath);
        loaded.push(spec.id === normalizedServerId ? spec : { ...spec, id: normalizedServerId });
      } catch (error) {
        this.logger?.warn("agent.managed_mcp_invalid", {
          tenant_id: scope.tenantId,
          agent_id: scope.agentId,
          server_id: normalizedServerId,
          revision: managed.revision,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return loaded;
  }
}

export function createLocalAgentContextStore(params: {
  db: SqlDb;
  home: string;
  identityScopeDal: IdentityScopeDal;
  logger?: Logger;
}): AgentContextStore {
  return new LocalAgentContextStore(params.db, params.home, params.identityScopeDal, params.logger);
}

function parseDefaultIdentity(): IdentityPackT {
  const parsed = parseFrontmatterDocument(DEFAULT_IDENTITY_MD);
  return IdentityPack.parse({
    meta: parsed.frontmatter,
  });
}

class SharedAgentContextStore implements AgentContextStore {
  private readonly identityDal: AgentIdentityDal;
  private readonly runtimePackageDal: RuntimePackageDal;
  private readonly bundledSkillsDir: string;

  constructor(
    db: SqlDb,
    private readonly home: string,
    private readonly logger?: Logger,
    bundledSkillsDir?: string,
  ) {
    this.identityDal = new AgentIdentityDal(db);
    this.runtimePackageDal = new RuntimePackageDal(db);
    this.bundledSkillsDir = bundledSkillsDir ?? resolveBundledSkillsDir();
  }

  async ensureAgentContext(scope: AgentContextScope): Promise<void> {
    await this.identityDal.ensureSeeded({
      tenantId: scope.tenantId,
      agentId: scope.agentId,
      defaultIdentity: parseDefaultIdentity(),
      createdBy: { kind: "shared-state.seed" },
      reason: "seed",
    });
  }

  async getIdentity(scope: AgentContextScope): Promise<IdentityPackT> {
    const revision = await this.identityDal.ensureSeeded({
      tenantId: scope.tenantId,
      agentId: scope.agentId,
      defaultIdentity: parseDefaultIdentity(),
      createdBy: { kind: "shared-state.seed" },
      reason: "seed",
    });
    return revision.identity;
  }

  async getEnabledSkills(
    scope: AgentContextScope,
    config: AgentConfigT,
  ): Promise<LoadedSkillManifest[]> {
    const sharedSkills = await this.runtimePackageDal.listLatest({
      tenantId: scope.tenantId,
      packageKind: "skill",
      enabledOnly: true,
    });
    const sharedById = new Map(sharedSkills.map((item) => [item.packageKey, item]));
    const loaded: LoadedSkillManifest[] = [];
    const bundledSkills = await listSkillsFromDir(this.bundledSkillsDir, "bundled", this.logger);
    const seen = new Set<string>();
    const orderedSkillIds = [
      ...sharedSkills.map((skill) => skill.packageKey),
      ...bundledSkills.map((skill) => skill.meta.id),
    ];

    for (const skillId of orderedSkillIds) {
      const normalizedSkillId = skillId.trim();
      if (
        normalizedSkillId.length === 0 ||
        seen.has(normalizedSkillId) ||
        !isAgentAccessAllowed(config.skills, normalizedSkillId)
      ) {
        continue;
      }
      seen.add(normalizedSkillId);

      const shared = sharedById.get(normalizedSkillId);
      if (shared) {
        try {
          const pkg = parseManagedSkillPackage(shared.packageData, normalizedSkillId);
          const path = await ensureManagedExtensionMaterialized({
            home: this.home,
            tenantId: scope.tenantId,
            stateMode: "shared",
            kind: "skill",
            revision: shared,
          });
          loaded.push({
            ...pkg.manifest,
            provenance: {
              source: "shared",
              path: path ?? `db://runtime-packages/skill/${normalizedSkillId}@${shared.revision}`,
            },
          });
          continue;
        } catch (error) {
          this.logger?.warn("agent.shared_skill_invalid", {
            tenant_id: scope.tenantId,
            agent_id: scope.agentId,
            skill_id: normalizedSkillId,
            revision: shared.revision,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const bundled = await loadSkillFromDir(
        this.bundledSkillsDir,
        normalizedSkillId,
        "bundled",
        this.logger,
      );
      if (bundled) {
        loaded.push(bundled);
      }
    }

    return loaded;
  }

  async getEnabledMcpServers(
    scope: AgentContextScope,
    config: AgentConfigT,
  ): Promise<McpServerSpecT[]> {
    const sharedServers = await this.runtimePackageDal.listLatest({
      tenantId: scope.tenantId,
      packageKind: "mcp",
      enabledOnly: true,
    });
    const sharedById = new Map(sharedServers.map((item) => [item.packageKey, item]));
    const loaded: McpServerSpecT[] = [];
    const seen = new Set<string>();
    for (const serverId of [
      buildBuiltinMemoryServerSpec().id,
      ...sharedServers.map((server) => server.packageKey),
    ]) {
      const normalizedServerId = serverId.trim();
      if (
        normalizedServerId.length === 0 ||
        seen.has(normalizedServerId) ||
        !isAgentAccessAllowed(config.mcp, normalizedServerId)
      ) {
        continue;
      }
      seen.add(normalizedServerId);

      if (normalizedServerId === buildBuiltinMemoryServerSpec().id) {
        loaded.push(buildBuiltinMemoryServerSpec());
        continue;
      }

      const shared = sharedById.get(normalizedServerId);
      if (!shared) continue;
      try {
        const pkg = parseManagedMcpPackage(shared.packageData, normalizedServerId);
        const materializedPath = await ensureManagedExtensionMaterialized({
          home: this.home,
          tenantId: scope.tenantId,
          stateMode: "shared",
          kind: "mcp",
          revision: shared,
        });
        const spec = normalizeManagedMcpSpec(pkg.spec, materializedPath);
        loaded.push(spec.id === normalizedServerId ? spec : { ...spec, id: normalizedServerId });
      } catch (error) {
        this.logger?.warn("agent.shared_mcp_invalid", {
          tenant_id: scope.tenantId,
          agent_id: scope.agentId,
          server_id: normalizedServerId,
          revision: shared.revision,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return loaded;
  }
}

export function createSharedAgentContextStore(params: {
  db: SqlDb;
  home: string;
  logger?: Logger;
  bundledSkillsDir?: string;
}): AgentContextStore {
  return new SharedAgentContextStore(
    params.db,
    params.home,
    params.logger,
    params.bundledSkillsDir,
  );
}

export function createDefaultAgentContextStore(params: {
  home: string;
  container: Pick<GatewayContainer, "db" | "deploymentConfig" | "identityScopeDal" | "logger">;
}): AgentContextStore {
  return resolveGatewayStateMode(params.container.deploymentConfig) === "shared"
    ? createSharedAgentContextStore({
        db: params.container.db,
        home: params.home,
        logger: params.container.logger,
      })
    : createLocalAgentContextStore({
        db: params.container.db,
        home: params.home,
        identityScopeDal: params.container.identityScopeDal,
        logger: params.container.logger,
      });
}
