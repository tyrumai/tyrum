import type { McpServerSpec as McpServerSpecT } from "@tyrum/schemas";
import type { ToolDescriptor } from "./tools.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "../observability/logger.js";

/**
 * Zod v4 `z.union` with `.default()` on the discriminant doesn't produce a
 * proper discriminated union at the type level. Cast through this interface
 * when the transport field is "remote" at runtime.
 */
interface McpRemoteSpec {
  id: string;
  name: string;
  enabled: boolean;
  transport: "remote";
  url: string;
  headers?: Record<string, string>;
  timeout_ms?: number;
  scopes?: string[];
}

function asRemote(spec: McpServerSpecT): McpRemoteSpec | undefined {
  const s = spec as unknown as { transport: string };
  return s.transport === "remote" ? (spec as unknown as McpRemoteSpec) : undefined;
}

interface McpStdioSpec {
  id: string;
  name: string;
  enabled: boolean;
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeout_ms?: number;
  scopes?: string[];
}

function asStdio(spec: McpServerSpecT): McpStdioSpec {
  return spec as unknown as McpStdioSpec;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface McpClientEntry {
  fingerprint: string;
  spec: McpServerSpecT;
  client: Client | null;
  transport: StdioClientTransport | StreamableHTTPClientTransport | null;
  connected: boolean;
  connectPromise?: Promise<void>;
  toolsCache?: readonly McpToolInfo[];
  descriptorCache?: readonly ToolDescriptor[];
  toolsPromise?: Promise<readonly ToolDescriptor[]>;
  discoveryFailureCount?: number;
  discoveryBackoffUntilMs?: number;
}

function discoveryBackoffMs(failureCount: number): number {
  const baseMs = 30_000;
  const capMs = 5 * 60_000;
  const exponent = Math.min(6, Math.max(0, failureCount - 1));
  return Math.min(capMs, baseMs * 2 ** exponent);
}

function stableFingerprint(spec: McpServerSpecT): string {
  const remote = asRemote(spec);
  if (remote) {
    return JSON.stringify({
      transport: remote.transport,
      url: remote.url,
      headers: remote.headers
        ? Object.entries(remote.headers).toSorted((a, b) => a[0].localeCompare(b[0]))
        : [],
      timeout_ms: remote.timeout_ms ?? null,
      scopes: remote.scopes ?? [],
    });
  }

  const stdio = asStdio(spec);
  const envEntries = stdio.env
    ? Object.entries(stdio.env).toSorted((a, b) => a[0].localeCompare(b[0]))
    : [];

  return JSON.stringify({
    transport: stdio.transport,
    command: stdio.command,
    args: stdio.args ?? [],
    env: envEntries,
    cwd: stdio.cwd ?? "",
    timeout_ms: stdio.timeout_ms ?? null,
    scopes: stdio.scopes ?? [],
  });
}

function toDescriptor(spec: McpServerSpecT, tool: McpToolInfo): ToolDescriptor {
  const toolId = `mcp.${spec.id}.${tool.name}`;
  const description = tool.description?.trim().length
    ? `${tool.description.trim()} (server=${spec.name})`
    : `MCP tool '${tool.name}' from server '${spec.name}'.`;

  return {
    id: toolId,
    description,
    risk: "medium",
    requires_confirmation: true,
    keywords: ["mcp", spec.id.toLowerCase(), spec.name.toLowerCase(), tool.name.toLowerCase()],
    source: "mcp",
    family: "mcp",
    backingServerId: spec.id,
    inputSchema:
      tool.inputSchema && typeof tool.inputSchema === "object"
        ? (tool.inputSchema as Record<string, unknown>)
        : undefined,
  };
}

function createTransport(
  spec: McpServerSpecT,
): StdioClientTransport | StreamableHTTPClientTransport {
  const remote = asRemote(spec);
  if (remote) {
    const url = new URL(remote.url);
    const requestInit: RequestInit | undefined = remote.headers
      ? { headers: remote.headers }
      : undefined;
    return new StreamableHTTPClientTransport(url, requestInit ? { requestInit } : undefined);
  }

  const stdio = asStdio(spec);
  return new StdioClientTransport({
    command: stdio.command,
    args: stdio.args,
    env: stdio.env ? ({ ...process.env, ...stdio.env } as Record<string, string>) : undefined,
    cwd: stdio.cwd,
    stderr: "pipe",
  });
}

function createClientAndTransport(spec: McpServerSpecT): {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
} {
  const transport = createTransport(spec);
  const client = new Client({ name: "tyrum-gateway", version: "0.1.0" }, { capabilities: {} });
  return { client, transport };
}

export class McpManager {
  private readonly entries = new Map<string, McpClientEntry>();
  private readonly logger: Logger | undefined;

  constructor(opts?: { logger?: Logger }) {
    this.logger = opts?.logger;
  }

  private reconcileEnabledServers(enabledServers: readonly McpServerSpecT[]): void {
    const enabledIds = new Set(
      enabledServers.filter((server) => server.enabled).map((server) => server.id),
    );
    for (const [serverId, entry] of this.entries.entries()) {
      if (!enabledIds.has(serverId)) {
        if (entry.client) {
          void entry.client.close().catch(() => undefined);
        }
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
      if (existing.client) {
        void existing.client.close().catch(() => undefined);
      }
      this.entries.delete(spec.id);
    }

    const { client, transport } = createClientAndTransport(spec);

    const entry: McpClientEntry = {
      fingerprint,
      spec,
      client,
      transport,
      connected: false,
    };

    this.entries.set(spec.id, entry);
    return entry;
  }

  private ensureClientOnEntry(entry: McpClientEntry): void {
    if (entry.client && entry.transport) return;
    const { client, transport } = createClientAndTransport(entry.spec);
    entry.client = client;
    entry.transport = transport;
    entry.connected = false;
    entry.connectPromise = undefined;
  }

  private async connectEntry(entry: McpClientEntry): Promise<void> {
    if (entry.connected) return;
    if (entry.connectPromise) return entry.connectPromise;

    this.ensureClientOnEntry(entry);

    // Invalidate tool cache when server announces dynamic changes.
    entry.client!.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      entry.toolsCache = undefined;
      entry.descriptorCache = undefined;
    });

    const timeoutMs = entry.spec.timeout_ms ?? 5_000;
    entry.connectPromise = entry
      .client!.connect(entry.transport!, { timeout: timeoutMs })
      .then(() => {
        entry.connected = true;
      })
      .finally(() => {
        entry.connectPromise = undefined;
      });

    return entry.connectPromise;
  }

  private invalidateEntryConnection(entry: McpClientEntry): void {
    if (entry.client) {
      void entry.client.close().catch(() => undefined);
    }
    entry.client = null;
    entry.transport = null;
    entry.connected = false;
    entry.connectPromise = undefined;
  }

  async shutdown(): Promise<void> {
    const entries = Array.from(this.entries.values());
    this.entries.clear();
    await Promise.all(
      entries.map((e) => (e.client ? e.client.close().catch(() => undefined) : undefined)),
    );
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
          return await this.listServerToolDescriptors(server);
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

    if (entry.descriptorCache) {
      return entry.descriptorCache;
    }
    if (entry.toolsPromise) {
      return entry.toolsPromise;
    }

    if (entry.discoveryBackoffUntilMs && Date.now() < entry.discoveryBackoffUntilMs) {
      return [];
    }

    entry.toolsPromise = this.fetchAndCacheTools(entry).finally(() => {
      entry.toolsPromise = undefined;
    });

    return entry.toolsPromise;
  }

  private async fetchAndCacheTools(entry: McpClientEntry): Promise<readonly ToolDescriptor[]> {
    try {
      await this.connectEntry(entry);

      const allTools: McpToolInfo[] = [];
      let cursor: string | undefined;
      const seenCursors = new Set<string>();
      let pages = 0;

      while (true) {
        if (pages++ >= 1_000) {
          throw new Error(`MCP tools/list exceeded 1000 pages for server '${entry.spec.id}'.`);
        }
        const page = await entry.client!.listTools(cursor ? { cursor } : undefined);
        for (const t of page.tools) {
          allTools.push({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          });
        }
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

      const descriptors = allTools.map((t) => toDescriptor(entry.spec, t));
      entry.toolsCache = allTools;
      entry.descriptorCache = descriptors;
      entry.discoveryFailureCount = undefined;
      entry.discoveryBackoffUntilMs = undefined;
      return descriptors;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn("mcp.tools_discovery_failed", {
        server_id: entry.spec.id,
        server_name: entry.spec.name,
        error: message,
      });
      const failures = (entry.discoveryFailureCount ?? 0) + 1;
      entry.discoveryFailureCount = failures;
      entry.discoveryBackoffUntilMs = Date.now() + discoveryBackoffMs(failures);
      this.invalidateEntryConnection(entry);
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
      await this.connectEntry(entry);
      const result = await entry.client!.callTool({ name: toolName, arguments: args });
      const isError = "isError" in result ? (result.isError as boolean | undefined) : undefined;
      return {
        content: "content" in result ? (result.content as unknown[]) : [],
        isError,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn("mcp.tool_call_failed", {
        server_id: server.id,
        server_name: server.name,
        tool: toolName,
        error: message,
      });
      this.invalidateEntryConnection(entry);
      return { content: [], isError: true };
    }
  }

  /**
   * Returns per-server cached MCP tools with server spec attached.
   * Useful for building tool definitions without re-querying the server.
   */
  getCachedToolsWithServer(
    servers: readonly McpServerSpecT[],
  ): { server: McpServerSpecT; tool: McpToolInfo }[] {
    const result: { server: McpServerSpecT; tool: McpToolInfo }[] = [];
    for (const server of servers) {
      const entry = this.entries.get(server.id);
      if (entry?.toolsCache) {
        for (const t of entry.toolsCache) {
          result.push({ server: entry.spec, tool: t });
        }
      }
    }
    return result;
  }
}
