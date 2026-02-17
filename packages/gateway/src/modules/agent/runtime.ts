import { randomUUID } from "node:crypto";
import type {
  AgentStatusResponse as AgentStatusResponseT,
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
  AgentConfig as AgentConfigT,
  McpServerSpec as McpServerSpecT,
  SkillManifest as SkillManifestT,
  IdentityPack as IdentityPackT,
} from "@tyrum/schemas";
import { AgentStatusResponse, AgentTurnResponse } from "@tyrum/schemas";
import type { GatewayContainer } from "../../container.js";
import { ensureWorkspaceInitialized, resolveTyrumHome } from "./home.js";
import { MarkdownMemoryStore } from "./markdown-memory.js";
import { SessionDal, type SessionMessage } from "./session-dal.js";
import {
  loadAgentConfig,
  loadEnabledMcpServers,
  loadEnabledSkills,
  loadIdentity,
} from "./workspace.js";
import { selectToolDirectory } from "./tools.js";
import { McpManager } from "./mcp-manager.js";

interface LlmMessage {
  role: "system" | "developer" | "user";
  content: string;
}

interface AgentLoadedContext {
  config: AgentConfigT;
  identity: IdentityPackT;
  skills: SkillManifestT[];
  mcpServers: McpServerSpecT[];
  memoryStore: MarkdownMemoryStore;
}

export interface AgentRuntimeOptions {
  container: GatewayContainer;
  home?: string;
  sessionDal?: SessionDal;
  fetchImpl?: typeof fetch;
}

function trimTo(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function formatSessionContext(summary: string, turns: SessionMessage[]): string {
  const lines: string[] = [];

  if (summary.trim().length > 0) {
    lines.push(`Summary: ${summary.trim()}`);
  }

  if (turns.length > 0) {
    lines.push("Recent messages:");
    for (const turn of turns.slice(-8)) {
      const role = turn.role === "assistant" ? "Assistant" : "User";
      lines.push(`${role}: ${trimTo(turn.content.trim(), 220)}`);
    }
  }

  return lines.join("\n");
}

function summarizeTurns(turns: SessionMessage[]): string {
  if (turns.length === 0) return "";
  const lines = turns.slice(-6).map((turn) => {
    const role = turn.role === "assistant" ? "A" : "U";
    return `${role}: ${trimTo(turn.content.trim(), 140)}`;
  });
  return trimTo(lines.join(" | "), 600);
}

function formatIdentityPrompt(identity: IdentityPackT): string {
  const styleParts: string[] = [];
  if (identity.meta.style?.tone) styleParts.push(`tone=${identity.meta.style.tone}`);
  if (identity.meta.style?.verbosity) {
    styleParts.push(`verbosity=${identity.meta.style.verbosity}`);
  }
  if (identity.meta.style?.format) styleParts.push(`format=${identity.meta.style.format}`);

  const styleLine =
    styleParts.length > 0 ? `Style: ${styleParts.join(", ")}` : "Style: default";

  const description = identity.meta.description
    ? `Description: ${identity.meta.description}`
    : "Description: none";

  return [`Identity: ${identity.meta.name}`, description, styleLine, identity.body]
    .filter((line) => line.trim().length > 0)
    .join("\n\n");
}

function formatSkillsPrompt(skills: readonly SkillManifestT[]): string {
  if (skills.length === 0) {
    return "No skills are enabled.";
  }

  const chunks = skills.map((skill) => {
    return [
      `Skill: ${skill.meta.name} (${skill.meta.id}@${skill.meta.version})`,
      skill.meta.description ? `Description: ${skill.meta.description}` : "",
      skill.body,
    ]
      .filter((line) => line.trim().length > 0)
      .join("\n");
  });

  return chunks.join("\n\n");
}

function formatToolPrompt(
  tools: ReturnType<typeof selectToolDirectory>,
): string {
  if (tools.length === 0) {
    return "No tools are allowed for this agent configuration.";
  }

  return tools
    .map((tool) => {
      return `${tool.id}: ${tool.description} (risk=${tool.risk}, confirmation=${tool.requires_confirmation})`;
    })
    .join("\n");
}

function formatMemoryPrompt(
  hits: Awaited<ReturnType<MarkdownMemoryStore["search"]>>,
): string {
  if (hits.length === 0) {
    return "No matching long-term memory found.";
  }

  return hits
    .map((hit) => `${hit.file}: ${hit.snippet}`)
    .join("\n");
}

function resolveModelBaseUrl(config: AgentConfigT): string {
  const configured = config.model.base_url?.trim();
  if (configured && configured.length > 0) {
    return configured.replace(/\/$/, "");
  }

  const rawHost =
    process.env["GATEWAY_HOST"]?.trim() ||
    process.env["HOST"]?.trim() ||
    process.env["SINGLE_HOST"]?.trim() ||
    "127.0.0.1";
  const port =
    process.env["GATEWAY_PORT"]?.trim() ||
    process.env["PORT"]?.trim() ||
    "8080";

  // Binding addresses like 0.0.0.0 / :: are not connectable as clients.
  const connectHost =
    rawHost === "0.0.0.0" ? "127.0.0.1" : rawHost === "::" ? "::1" : rawHost;

  const hostForUrl =
    connectHost.includes(":") && !connectHost.startsWith("[") && !connectHost.endsWith("]")
      ? `[${connectHost}]`
      : connectHost;

  return `http://${hostForUrl}:${port}/v1`;
}

function resolveChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/v1")) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
}

function readChoiceText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const choices = record["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return undefined;

  const choice = choices[0];
  if (!choice || typeof choice !== "object") return undefined;
  const message = (choice as Record<string, unknown>)["message"];
  if (!message || typeof message !== "object") return undefined;
  const content = (message as Record<string, unknown>)["content"];

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        (part as Record<string, unknown>)["type"] === "text" &&
        typeof (part as Record<string, unknown>)["text"] === "string"
      ) {
        parts.push((part as Record<string, unknown>)["text"] as string);
      }
    }
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }

  return undefined;
}

async function maybeJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (raw.trim().length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw };
  }
}

function shouldPromoteToCoreMemory(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("i prefer") ||
    normalized.includes("remember that") ||
    normalized.includes("always ") ||
    normalized.includes("never ")
  );
}

export class AgentRuntime {
  private readonly home: string;
  private readonly sessionDal: SessionDal;
  private readonly fetchImpl: typeof fetch;
  private readonly mcpManager = new McpManager();
  private cleanupAtMs = 0;

  constructor(private readonly opts: AgentRuntimeOptions) {
    this.home = opts.home ?? resolveTyrumHome();
    this.sessionDal = opts.sessionDal ?? opts.container.sessionDal;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async loadContext(): Promise<AgentLoadedContext> {
    await ensureWorkspaceInitialized(this.home);
    const config = await loadAgentConfig(this.home);
    const identity = await loadIdentity(this.home);
    const skills = await loadEnabledSkills(this.home, config);
    const mcpServers = await loadEnabledMcpServers(this.home, config);
    const memoryStore = new MarkdownMemoryStore(this.home);
    await memoryStore.ensureInitialized();

    return {
      config,
      identity,
      skills,
      mcpServers,
      memoryStore,
    };
  }

  private maybeCleanupSessions(ttlDays: number): void {
    const now = Date.now();
    if (now < this.cleanupAtMs) {
      return;
    }
    this.sessionDal.deleteExpired(ttlDays);
    this.cleanupAtMs = now + 60 * 60 * 1000;
  }

  async status(enabled: boolean): Promise<AgentStatusResponseT> {
    if (!enabled) {
      return AgentStatusResponse.parse({
        enabled: false,
        home: this.home,
        identity: {
          name: "disabled",
        },
        model: {
          model: "disabled",
        },
        skills: [],
        mcp: [],
        tools: [],
        sessions: {
          ttl_days: 30,
          max_turns: 20,
        },
      });
    }

    const ctx = await this.loadContext();
    const status = {
      enabled: true,
      home: this.home,
      identity: {
        name: ctx.identity.meta.name,
        description: ctx.identity.meta.description,
      },
      model: ctx.config.model,
      skills: ctx.skills.map((skill) => skill.meta.id),
      mcp: ctx.mcpServers.map((server) => ({
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        transport: server.transport,
      })),
      tools: ctx.config.tools.allow,
      sessions: ctx.config.sessions,
    };

    return AgentStatusResponse.parse(status);
  }

  async turn(input: AgentTurnRequestT): Promise<AgentTurnResponseT> {
    const ctx = await this.loadContext();
    this.maybeCleanupSessions(ctx.config.sessions.ttl_days);

    const session = this.sessionDal.getOrCreate(input.channel, input.thread_id);
    const wantsMcpTools = ctx.config.tools.allow.some(
      (entry) => entry === "*" || entry === "mcp*" || entry.startsWith("mcp."),
    );

    const [memoryHits, mcpTools] = await Promise.all([
      ctx.config.memory.markdown_enabled
        ? ctx.memoryStore.search(input.message, 5)
        : Promise.resolve([]),
      wantsMcpTools
        ? this.mcpManager.listToolDescriptors(ctx.mcpServers)
        : Promise.resolve([]),
    ]);

    const tools = selectToolDirectory(input.message, ctx.config.tools.allow, mcpTools, 8);

    const messages: LlmMessage[] = [
      {
        role: "system",
        content: formatIdentityPrompt(ctx.identity),
      },
      {
        role: "developer",
        content: `Enabled skills:\n${formatSkillsPrompt(ctx.skills)}`,
      },
      {
        role: "developer",
        content: `Available tools:\n${formatToolPrompt(tools)}`,
      },
      {
        role: "developer",
        content: `Session context:\n${formatSessionContext(session.summary, session.turns)}`,
      },
      {
        role: "developer",
        content: `Long-term memory matches:\n${formatMemoryPrompt(memoryHits)}`,
      },
      {
        role: "user",
        content: input.message,
      },
    ];

    const modelBaseUrl = resolveModelBaseUrl(ctx.config);
    const completionsUrl = resolveChatCompletionsUrl(modelBaseUrl);

    const response = await this.fetchImpl(completionsUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ctx.config.model.model,
        messages,
      }),
    });

    if (!response.ok) {
      const payload = await maybeJson(response);
      const payloadText =
        typeof payload === "object" ? JSON.stringify(payload) : String(payload);
      throw new Error(
        `model completion request failed (${response.status}): ${payloadText}`,
      );
    }

    const payload = await maybeJson(response);
    const reply = readChoiceText(payload) ?? "No assistant response returned.";
    const nowIso = new Date().toISOString();

    const updated = this.sessionDal.appendTurn(
      session.session_id,
      input.message,
      reply,
      ctx.config.sessions.max_turns,
      nowIso,
    );
    this.sessionDal.updateSummary(
      session.session_id,
      summarizeTurns(updated.turns),
    );

    let memoryWritten = false;
    if (ctx.config.memory.markdown_enabled) {
      const entry = [
        `Channel: ${input.channel}`,
        `Thread: ${input.thread_id}`,
        `User: ${input.message}`,
        `Assistant: ${reply}`,
      ].join("\n");
      await ctx.memoryStore.appendDaily(entry);
      memoryWritten = true;

      if (shouldPromoteToCoreMemory(input.message)) {
        await ctx.memoryStore.appendToCoreSection(
          "Learned Preferences",
          `- ${input.message.trim()}`,
        );
      }
    }

    this.opts.container.memoryDal.insertEpisodicEvent(
      `agent-turn-${randomUUID()}`,
      nowIso,
      input.channel,
      "agent_turn",
      {
        session_id: session.session_id,
      },
    );

    return AgentTurnResponse.parse({
      reply,
      session_id: session.session_id,
      memory_written: memoryWritten,
    });
  }
}
