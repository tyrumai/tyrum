import type {
  AgentConfig as AgentConfigT,
  IdentityPack as IdentityPackT,
  McpServerSpec as McpServerSpecT,
} from "@tyrum/schemas";
import { ensureWorkspaceInitialized } from "./home.js";
import { MarkdownMemoryStore, type MemorySearchHit } from "./markdown-memory.js";
import {
  loadEnabledMcpServers,
  loadEnabledSkills,
  loadIdentity,
  type LoadedSkillManifest,
} from "./workspace.js";
import type { Logger } from "../observability/logger.js";

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
