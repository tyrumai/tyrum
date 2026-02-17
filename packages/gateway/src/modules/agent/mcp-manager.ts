import type { McpServerSpec as McpServerSpecT } from "@tyrum/schemas";
import type { ToolDescriptor } from "./tools.js";
import { McpStdioClient, type McpToolInfo } from "./mcp-stdio-client.js";

interface McpClientEntry {
  fingerprint: string;
  spec: McpServerSpecT;
  client: McpStdioClient;
  toolsCache?: readonly ToolDescriptor[];
  toolsPromise?: Promise<readonly ToolDescriptor[]>;
  discoveryFailureCount?: number;
  discoveryBackoffUntilMs?: number;
}

function discoveryBackoffMs(failureCount: number): number {
  // Avoid repeatedly blocking the agent turn on unreachable servers.
  // Exponential backoff capped at 5 minutes.
  const baseMs = 30_000;
  const capMs = 5 * 60_000;
  const exponent = Math.min(6, Math.max(0, failureCount - 1));
  return Math.min(capMs, baseMs * 2 ** exponent);
}

function stableFingerprint(spec: McpServerSpecT): string {
  const envEntries = spec.env
    ? Object.entries(spec.env).sort((a, b) => a[0].localeCompare(b[0]))
    : [];
  return JSON.stringify({
    transport: spec.transport,
    command: spec.command,
    args: spec.args ?? [],
    env: envEntries,
    cwd: spec.cwd ?? "",
    timeout_ms: spec.timeout_ms ?? null,
    scopes: spec.scopes ?? [],
  });
}

function toMcpToolDescriptor(spec: McpServerSpecT, tool: McpToolInfo): ToolDescriptor {
  const toolId = `mcp.${spec.id}.${tool.name}`;
  const description = tool.description?.trim().length
    ? `${tool.description.trim()} (server=${spec.name})`
    : `MCP tool '${tool.name}' from server '${spec.name}'.`;

  return {
    id: toolId,
    description,
    risk: "medium",
    requires_confirmation: true,
    keywords: [
      "mcp",
      spec.id.toLowerCase(),
      spec.name.toLowerCase(),
      tool.name.toLowerCase(),
    ],
  };
}

export class McpManager {
  private readonly entries = new Map<string, McpClientEntry>();

  private reconcileEnabledServers(enabledServers: readonly McpServerSpecT[]): void {
    // Only keep running entries for currently enabled servers.
    const enabledIds = new Set(
      enabledServers.filter((server) => server.enabled).map((server) => server.id),
    );
    for (const [serverId, entry] of this.entries.entries()) {
      if (!enabledIds.has(serverId)) {
        void entry.client.stop();
        this.entries.delete(serverId);
      }
    }
  }

  private ensureEntry(spec: McpServerSpecT): McpClientEntry {
    const fingerprint = stableFingerprint(spec);
    const existing = this.entries.get(spec.id);
    if (existing && existing.fingerprint === fingerprint) {
      return existing;
    }

    if (existing) {
      // Spec changed; stop the old process and replace.
      void existing.client.stop();
      this.entries.delete(spec.id);
    }

    const client = new McpStdioClient(spec);
    const entry: McpClientEntry = {
      fingerprint,
      spec,
      client,
    };
    this.entries.set(spec.id, entry);
    return entry;
  }

  async shutdown(): Promise<void> {
    const entries = Array.from(this.entries.values());
    this.entries.clear();
    await Promise.all(entries.map((entry) => entry.client.stop()));
  }

  async listToolDescriptors(
    enabledServers: readonly McpServerSpecT[],
  ): Promise<readonly ToolDescriptor[]> {
    const descriptors: ToolDescriptor[] = [];

    this.reconcileEnabledServers(enabledServers);

    const results = await Promise.allSettled(
      enabledServers
        .filter((server) => server.enabled)
        .map(async (server) => {
          const tools = await this.listServerToolDescriptors(server);
          return tools;
        }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        descriptors.push(...result.value);
      }
    }

    return descriptors;
  }

  async listServerToolDescriptors(server: McpServerSpecT): Promise<readonly ToolDescriptor[]> {
    if (!server.enabled) return [];
    const entry = this.ensureEntry(server);

    if (entry.toolsCache) {
      return entry.toolsCache;
    }
    if (entry.toolsPromise) {
      return entry.toolsPromise;
    }

    if (entry.discoveryBackoffUntilMs && Date.now() < entry.discoveryBackoffUntilMs) {
      return [];
    }

    entry.toolsPromise = this.fetchAndCacheToolDescriptors(entry).finally(() => {
      entry.toolsPromise = undefined;
    });

    return entry.toolsPromise;
  }

  private async fetchAndCacheToolDescriptors(entry: McpClientEntry): Promise<readonly ToolDescriptor[]> {
    try {
      const allTools: McpToolInfo[] = [];
      let cursor: string | undefined;
      const seenCursors = new Set<string>();
      let pages = 0;

      while (true) {
        if (pages++ >= 1_000) {
          throw new Error(
            `MCP tools/list exceeded 1000 pages for server '${entry.spec.id}'.`,
          );
        }
        const page = await entry.client.toolsList(cursor);
        allTools.push(...page.tools);
        const nextCursor = page.nextCursor;
        if (!nextCursor) break;
        if (seenCursors.has(nextCursor)) {
          throw new Error(
            `MCP tools/list cursor loop detected for server '${entry.spec.id}' (cursor='${nextCursor}').`,
          );
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }

      const descriptors = allTools.map((tool) => toMcpToolDescriptor(entry.spec, tool));
      entry.toolsCache = descriptors;
      entry.discoveryFailureCount = undefined;
      entry.discoveryBackoffUntilMs = undefined;
      return descriptors;
    } catch {
      // Degrade gracefully if the server isn't reachable or misbehaves.
      // Do not cache failures indefinitely: transient discovery errors should be retried
      // on a later call, but not on every agent turn.
      const failures = (entry.discoveryFailureCount ?? 0) + 1;
      entry.discoveryFailureCount = failures;
      entry.discoveryBackoffUntilMs = Date.now() + discoveryBackoffMs(failures);
      void entry.client.stop();
      return [];
    }
  }

  async callTool(
    server: McpServerSpecT,
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<{ content: unknown[]; isError?: boolean }> {
    if (!server.enabled) {
      return { content: [], isError: true };
    }
    const entry = this.ensureEntry(server);
    try {
      return await entry.client.toolsCall(toolName, args);
    } catch {
      return { content: [], isError: true };
    }
  }
}
