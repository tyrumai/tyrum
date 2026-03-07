import type {
  AgentConfig as AgentConfigT,
  IdentityPack as IdentityPackT,
  McpServerSpec as McpServerSpecT,
} from "@tyrum/schemas";
import { IdentityPack, McpServerSpec, SkillManifest } from "@tyrum/schemas";
import {
  ensureWorkspaceInitialized,
  DEFAULT_IDENTITY_MD,
  resolveBundledSkillsDir,
} from "./home.js";
import { MarkdownMemoryStore, type MemorySearchHit } from "./markdown-memory.js";
import { AgentIdentityDal } from "./identity-dal.js";
import { MarkdownMemoryDal } from "./markdown-memory-dal.js";
import { RuntimePackageDal } from "./runtime-package-dal.js";
import { SharedMarkdownMemoryStore } from "./shared-markdown-memory-store.js";
import {
  loadSkillFromDir,
  loadEnabledMcpServers,
  loadEnabledSkills,
  loadIdentity,
  type LoadedSkillManifest,
} from "./workspace.js";
import { parseFrontmatterDocument } from "./frontmatter.js";
import type { Logger } from "../observability/logger.js";
import type { SqlDb } from "../../statestore/types.js";
import { resolveGatewayStateMode } from "../runtime-state/mode.js";
import type { GatewayContainer } from "../../container.js";

export interface AgentContextScope {
  tenantId: string;
  agentId: string;
  workspaceId: string;
}

export interface AgentMemoryStore {
  ensureInitialized(): Promise<void>;
  appendDaily(entry: string, date?: Date): Promise<string>;
  upsertCoreSection(sectionKey: string, content: string): Promise<void>;
  appendToCoreSection(sectionKey: string, line: string): Promise<void>;
  search(query: string, limit: number): Promise<MemorySearchHit[]>;
}

export interface AgentContextStore {
  ensureAgentContext(scope: AgentContextScope): Promise<void>;
  getIdentity(scope: AgentContextScope): Promise<IdentityPackT>;
  getEnabledSkills(scope: AgentContextScope, config: AgentConfigT): Promise<LoadedSkillManifest[]>;
  getEnabledMcpServers(scope: AgentContextScope, config: AgentConfigT): Promise<McpServerSpecT[]>;
  createMemoryStore(scope: AgentContextScope): AgentMemoryStore;
}

class LocalAgentContextStore implements AgentContextStore {
  constructor(
    private readonly home: string,
    private readonly logger?: Logger,
  ) {}

  async ensureAgentContext(_scope: AgentContextScope): Promise<void> {
    await ensureWorkspaceInitialized(this.home);
  }

  async getIdentity(_scope: AgentContextScope): Promise<IdentityPackT> {
    return await loadIdentity(this.home);
  }

  async getEnabledSkills(
    _scope: AgentContextScope,
    config: AgentConfigT,
  ): Promise<LoadedSkillManifest[]> {
    return await loadEnabledSkills(this.home, config, {
      logger: this.logger,
    });
  }

  async getEnabledMcpServers(
    _scope: AgentContextScope,
    config: AgentConfigT,
  ): Promise<McpServerSpecT[]> {
    return await loadEnabledMcpServers(this.home, config, {
      logger: this.logger,
    });
  }

  createMemoryStore(_scope: AgentContextScope): AgentMemoryStore {
    return new MarkdownMemoryStore(this.home);
  }
}

export function createLocalAgentContextStore(params: {
  home: string;
  logger?: Logger;
}): AgentContextStore {
  return new LocalAgentContextStore(params.home, params.logger);
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
  private readonly markdownMemoryDal: MarkdownMemoryDal;
  private readonly bundledSkillsDir: string;

  constructor(
    db: SqlDb,
    private readonly logger?: Logger,
    bundledSkillsDir?: string,
  ) {
    this.identityDal = new AgentIdentityDal(db);
    this.runtimePackageDal = new RuntimePackageDal(db);
    this.markdownMemoryDal = new MarkdownMemoryDal(db);
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
    await this.markdownMemoryDal.ensureCoreDoc({
      tenantId: scope.tenantId,
      agentId: scope.agentId,
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
        const parsed = SkillManifest.safeParse(shared.packageData);
        if (!parsed.success) {
          this.logger?.warn("agent.shared_skill_invalid", {
            tenant_id: scope.tenantId,
            agent_id: scope.agentId,
            skill_id: skillId,
            revision: shared.revision,
            error: parsed.error.message,
          });
        } else {
          loaded.push({
            ...parsed.data,
            provenance: {
              source: "shared",
              path: `db://runtime-packages/skill/${skillId}@${shared.revision}`,
            },
          });
          continue;
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
      const parsed = McpServerSpec.safeParse(shared.packageData);
      if (!parsed.success) {
        this.logger?.warn("agent.shared_mcp_invalid", {
          tenant_id: scope.tenantId,
          agent_id: scope.agentId,
          server_id: serverId,
          revision: shared.revision,
          error: parsed.error.message,
        });
        continue;
      }
      loaded.push(parsed.data.id === serverId ? parsed.data : { ...parsed.data, id: serverId });
    }

    return loaded;
  }

  createMemoryStore(scope: AgentContextScope): AgentMemoryStore {
    return new SharedMarkdownMemoryStore(this.markdownMemoryDal, {
      tenantId: scope.tenantId,
      agentId: scope.agentId,
    });
  }
}

export function createSharedAgentContextStore(params: {
  db: SqlDb;
  logger?: Logger;
  bundledSkillsDir?: string;
}): AgentContextStore {
  return new SharedAgentContextStore(params.db, params.logger, params.bundledSkillsDir);
}

export function createDefaultAgentContextStore(params: {
  home: string;
  container: Pick<GatewayContainer, "db" | "deploymentConfig" | "logger">;
}): AgentContextStore {
  return resolveGatewayStateMode(params.container.deploymentConfig) === "shared"
    ? createSharedAgentContextStore({
        db: params.container.db,
        logger: params.container.logger,
      })
    : createLocalAgentContextStore({
        home: params.home,
        logger: params.container.logger,
      });
}
