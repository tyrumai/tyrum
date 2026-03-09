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
  resolveSkillsDir,
  resolveUserSkillsDir,
} from "./home.js";
import { AgentIdentityDal } from "./identity-dal.js";
import { RuntimePackageDal } from "./runtime-package-dal.js";
import {
  loadSkillFromDir,
  loadEnabledMcpServers,
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
      packageKeys: config.skills.enabled,
      enabledOnly: true,
    });
    const managedById = new Map(managedSkills.map((item) => [item.packageKey, item]));
    const loaded: LoadedSkillManifest[] = [];
    const workspaceSkillsDir = resolveSkillsDir(this.home);
    const userSkillsDir = resolveUserSkillsDir();
    const bundledSkillsDir = resolveBundledSkillsDir();
    const workspaceTrusted = config.skills.workspace_trusted === true;

    for (const skillId of config.skills.enabled) {
      const workspaceSkill = workspaceTrusted
        ? await loadSkillFromDir(workspaceSkillsDir, skillId, "workspace", this.logger)
        : undefined;
      if (workspaceSkill) {
        loaded.push(workspaceSkill);
        continue;
      }

      const managed = managedById.get(skillId);
      if (managed) {
        try {
          const pkg = parseManagedSkillPackage(managed.packageData, skillId);
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
              path: materializedPath ?? `db://runtime-packages/skill/${skillId}@${managed.revision}`,
            },
          });
          continue;
        } catch (error) {
          this.logger?.warn("agent.managed_skill_invalid", {
            tenant_id: scope.tenantId,
            agent_id: scope.agentId,
            skill_id: skillId,
            revision: managed.revision,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const fallback =
        (await loadSkillFromDir(userSkillsDir, skillId, "user", this.logger)) ??
        (await loadSkillFromDir(bundledSkillsDir, skillId, "bundled", this.logger));
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
      packageKeys: config.mcp.enabled,
      enabledOnly: true,
    });
    const managedById = new Map(managedServers.map((item) => [item.packageKey, item]));
    const localServers = await loadEnabledMcpServers(this.home, config, {
      logger: this.logger,
    });
    const localById = new Map(localServers.map((item) => [item.id, item]));
    const loaded: McpServerSpecT[] = [];

    for (const serverId of config.mcp.enabled) {
      const local = localById.get(serverId);
      if (local) {
        loaded.push(local);
        continue;
      }
      const managed = managedById.get(serverId);
      if (!managed) continue;
      try {
        const pkg = parseManagedMcpPackage(managed.packageData, serverId);
        const materializedPath = await ensureManagedExtensionMaterialized({
          home: this.home,
          tenantId: scope.tenantId,
          stateMode: "local",
          kind: "mcp",
          revision: managed,
        });
        const spec = pkg.spec.transport === "stdio" && !pkg.spec.cwd && materializedPath
          ? { ...pkg.spec, cwd: materializedPath.replace(/\/server\.yml$/u, "") }
          : pkg.spec;
        loaded.push(spec.id === serverId ? spec : { ...spec, id: serverId });
      } catch (error) {
        this.logger?.warn("agent.managed_mcp_invalid", {
          tenant_id: scope.tenantId,
          agent_id: scope.agentId,
          server_id: serverId,
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
    body: parsed.body.trim(),
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
      packageKeys: config.skills.enabled,
      enabledOnly: true,
    });
    const sharedById = new Map(sharedSkills.map((item) => [item.packageKey, item]));
    const loaded: LoadedSkillManifest[] = [];

    for (const skillId of config.skills.enabled) {
      const shared = sharedById.get(skillId);
      if (shared) {
        try {
          const pkg = parseManagedSkillPackage(shared.packageData, skillId);
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
              path: path ?? `db://runtime-packages/skill/${skillId}@${shared.revision}`,
            },
          });
          continue;
        } catch (error) {
          this.logger?.warn("agent.shared_skill_invalid", {
            tenant_id: scope.tenantId,
            agent_id: scope.agentId,
            skill_id: skillId,
            revision: shared.revision,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const bundled = await loadSkillFromDir(
        this.bundledSkillsDir,
        skillId,
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
      packageKeys: config.mcp.enabled,
      enabledOnly: true,
    });
    const sharedById = new Map(sharedServers.map((item) => [item.packageKey, item]));
    const loaded: McpServerSpecT[] = [];

    for (const serverId of config.mcp.enabled) {
      const shared = sharedById.get(serverId);
      if (!shared) continue;
      try {
        const pkg = parseManagedMcpPackage(shared.packageData, serverId);
        const materializedPath = await ensureManagedExtensionMaterialized({
          home: this.home,
          tenantId: scope.tenantId,
          stateMode: "shared",
          kind: "mcp",
          revision: shared,
        });
        const spec =
          pkg.spec.transport === "stdio" && !pkg.spec.cwd && materializedPath
            ? { ...pkg.spec, cwd: materializedPath.replace(/\/server\.yml$/u, "") }
            : pkg.spec;
        loaded.push(spec.id === serverId ? spec : { ...spec, id: serverId });
      } catch (error) {
        this.logger?.warn("agent.shared_mcp_invalid", {
          tenant_id: scope.tenantId,
          agent_id: scope.agentId,
          server_id: serverId,
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
  return new SharedAgentContextStore(params.db, params.home, params.logger, params.bundledSkillsDir);
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
