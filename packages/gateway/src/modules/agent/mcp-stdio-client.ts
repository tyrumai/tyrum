import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { McpServerSpec as McpServerSpecT } from "@tyrum/schemas";

/**
 * Minimal MCP stdio transport client.
 *
 * Transport framing: newline-delimited JSON-RPC 2.0 objects on stdout/stdin.
 * Each JSON-RPC message MUST be written as a single line (no embedded newlines).
 */

type JsonRpcId = number;

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

function asStdioSpec(spec: McpServerSpecT): McpStdioSpec {
  const record = spec as unknown as { transport?: string };
  if (record.transport !== "stdio") {
    throw new Error("McpStdioClient requires transport=stdio");
  }
  return spec as unknown as McpStdioSpec;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpToolsListResult {
  tools: McpToolInfo[];
  nextCursor?: string;
}

export interface McpToolsCallResult {
  content: unknown[];
  isError?: boolean;
}

function safeErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function resolveTimeoutMs(spec: McpServerSpecT): number {
  // Keep a sane default to avoid hung /agent/turn calls.
  return spec.timeout_ms ?? 5_000;
}

const DEFAULT_MCP_PROTOCOL_VERSION = "2024-11-05";

function resolveClientProtocolVersion(): string {
  const fromEnv = process.env["TYRUM_MCP_PROTOCOL_VERSION"]?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_MCP_PROTOCOL_VERSION;
}

function parseProtocolDateVersion(version: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) {
    return undefined;
  }
  const parsed = Date.parse(`${version}T00:00:00Z`);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isProtocolVersionCompatible(serverVersion: string, requestedVersion: string): boolean {
  const serverDate = parseProtocolDateVersion(serverVersion);
  // If server version is not date-based, avoid hard-failing on unknown-but-valid formats.
  if (serverDate === undefined) {
    return true;
  }

  const requestedDate = parseProtocolDateVersion(requestedVersion);
  const minSupportedDate = parseProtocolDateVersion(DEFAULT_MCP_PROTOCOL_VERSION);
  const requiredDate = requestedDate ?? minSupportedDate;

  if (requiredDate === undefined) {
    return true;
  }
  return serverDate >= requiredDate;
}

function parseInitializeProtocolVersion(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const protocolVersion = (result as Record<string, unknown>)["protocolVersion"];
  return typeof protocolVersion === "string" && protocolVersion.trim().length > 0
    ? protocolVersion.trim()
    : undefined;
}

export class McpStdioClient {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private buffer = "";
  private stderrTail = "";
  private nextId: JsonRpcId = 1;
  private negotiatedProtocolVersion: string | undefined;
  private readonly spec: McpStdioSpec;
  private readonly pending = new Map<
    JsonRpcId,
    {
      method: string;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  private started = false;
  private startPromise: Promise<void> | undefined;

  constructor(spec: McpServerSpecT) {
    this.spec = asStdioSpec(spec);
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startInternal()
      .then(() => {
        this.started = true;
      })
      .catch(async (err) => {
        // Reset so a future call can retry after a failure.
        this.startPromise = undefined;
        // Kill the spawned process to prevent leaked child processes.
        await this.stop();
        throw err;
      });

    return this.startPromise;
  }

  private async startInternal(): Promise<void> {
    // Clear leftover I/O buffers from any previous process to prevent
    // stale bytes from corrupting the new process's JSON-RPC framing.
    this.buffer = "";
    this.stderrTail = "";
    this.negotiatedProtocolVersion = undefined;

    const args = this.spec.args ?? [];
    const env = {
      ...process.env,
      ...this.spec.env,
    };

    this.proc = spawn(this.spec.command, args, {
      cwd: this.spec.cwd,
      env,
      stdio: "pipe",
    });

    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");

    this.proc.stdout.on("data", (chunk: string) => {
      this.onStdout(chunk);
    });

    this.proc.stderr.on("data", (chunk: string) => {
      // Keep a small tail for diagnostics.
      const next = `${this.stderrTail}${chunk}`;
      this.stderrTail = next.length > 8_000 ? next.slice(next.length - 8_000) : next;
    });

    const onExit = (reason: string): void => {
      this.rejectAllPending(new Error(`MCP server exited (${reason}). stderr: ${this.stderrTail}`));
      this.started = false;
      this.startPromise = undefined;
      this.proc = undefined;
      this.buffer = "";
      this.stderrTail = "";
    };

    this.proc.on("error", (err) => {
      onExit(`error: ${safeErrorMessage(err)}`);
    });
    this.proc.on("close", (code, signal) => {
      onExit(`code=${code ?? "null"} signal=${signal ?? "null"}`);
    });

    // MCP initialize handshake.
    const timeoutMs = resolveTimeoutMs(this.spec);
    const requestedProtocolVersion = resolveClientProtocolVersion();
    const initResult = await this.requestNoStart(
      "initialize",
      {
        protocolVersion: requestedProtocolVersion,
        capabilities: {},
        clientInfo: {
          name: "tyrum-gateway",
          version: "0.1.0",
        },
      },
      timeoutMs,
    );

    const serverProtocolVersion = parseInitializeProtocolVersion(initResult);
    if (!serverProtocolVersion) {
      throw new Error(
        `MCP initialize did not return a protocolVersion. stderr: ${this.stderrTail}`,
      );
    }
    if (!isProtocolVersionCompatible(serverProtocolVersion, requestedProtocolVersion)) {
      throw new Error(
        `Unsupported MCP protocol version '${serverProtocolVersion}'. Required >= '${requestedProtocolVersion}'.`,
      );
    }
    this.negotiatedProtocolVersion = serverProtocolVersion;

    this.notify("initialized");
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = undefined;
    this.started = false;
    this.startPromise = undefined;
    this.rejectAllPending(new Error("MCP client stopped"));
    this.buffer = "";
    this.stderrTail = "";
    this.negotiatedProtocolVersion = undefined;

    if (!proc) return;

    proc.stdout.removeAllListeners();
    proc.stderr.removeAllListeners();
    proc.removeAllListeners();

    // If the process already exited, nothing to wait for.
    if (proc.exitCode !== null || proc.signalCode !== null) {
      return;
    }

    // Best-effort graceful shutdown with a short wait to avoid leaked processes in tests.
    const closed = new Promise<void>((resolve) => {
      proc.once("close", () => resolve());
    });

    try {
      proc.stdin.end();
    } catch {
      // ignore
    }
    try {
      proc.kill("SIGTERM");
    } catch {
      // ignore
    }

    const hardKillTimer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 1_000);

    await Promise.race([
      closed.catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 1_500)),
    ]);
    clearTimeout(hardKillTimer);
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;

    while (true) {
      const newlineIdx = this.buffer.indexOf("\n");
      if (newlineIdx === -1) break;

      let line = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      let msg: unknown;
      try {
        msg = JSON.parse(trimmed) as unknown;
      } catch {
        // Treat as server log noise.
        continue;
      }

      this.onMessage(msg);
    }
  }

  private onMessage(msg: unknown): void {
    if (!msg || typeof msg !== "object") return;
    const record = msg as Record<string, unknown>;

    if (record["jsonrpc"] !== "2.0") return;
    const idRaw = record["id"];

    // Notification: no id.
    if (idRaw === undefined) {
      return;
    }

    if (typeof idRaw !== "number") {
      return;
    }

    const pending = this.pending.get(idRaw);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pending.delete(idRaw);

    const errorRaw = record["error"];
    if (errorRaw && typeof errorRaw === "object") {
      const errorRecord = errorRaw as Record<string, unknown>;
      const message =
        typeof errorRecord["message"] === "string"
          ? (errorRecord["message"] as string)
          : "unknown MCP JSON-RPC error";
      pending.reject(
        new Error(
          `MCP request '${pending.method}' failed: ${message}. stderr: ${this.stderrTail}`,
        ),
      );
      return;
    }

    pending.resolve(record["result"]);
  }

  private writeMessage(obj: JsonRpcRequest | JsonRpcNotification): void {
    const proc = this.proc;
    if (!proc || !proc.stdin.writable) {
      throw new Error("MCP server process is not writable");
    }

    const serialized = JSON.stringify(obj);
    if (serialized.includes("\n")) {
      // Safety guard: newline-delimited framing cannot handle embedded newlines.
      throw new Error("refusing to write MCP message containing newline");
    }

    proc.stdin.write(`${serialized}\n`);
  }

  notify(method: string, params?: unknown): void {
    try {
      this.writeMessage({
        jsonrpc: "2.0",
        method,
        ...(params === undefined ? {} : { params }),
      });
    } catch {
      // Best-effort; notifications should not crash the caller.
    }
  }

  private async requestNoStart(
    method: string,
    params?: unknown,
    timeoutMs?: number,
  ): Promise<unknown> {
    const id = this.nextId++;

    const effectiveTimeoutMs = timeoutMs ?? resolveTimeoutMs(this.spec);

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `MCP request '${method}' timed out after ${effectiveTimeoutMs}ms. stderr: ${this.stderrTail}`,
          ),
        );
      }, effectiveTimeoutMs);

      this.pending.set(id, {
        method,
        resolve,
        reject,
        timeout,
      });

      try {
        this.writeMessage({
          jsonrpc: "2.0",
          id,
          method,
          ...(params === undefined ? {} : { params }),
        });
      } catch (err) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(new Error(`failed to write MCP request '${method}': ${safeErrorMessage(err)}`));
      }
    });
  }

  async request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    await this.start();
    if (!this.negotiatedProtocolVersion) {
      throw new Error("MCP client is not initialized");
    }
    return this.requestNoStart(method, params, timeoutMs);
  }

  async toolsList(cursor?: string): Promise<McpToolsListResult> {
    const result = await this.request(
      "tools/list",
      cursor ? { cursor } : undefined,
    );

    if (!result || typeof result !== "object") {
      return { tools: [] };
    }
    const record = result as Record<string, unknown>;
    const toolsRaw = record["tools"];
    const tools: McpToolInfo[] = [];
    if (Array.isArray(toolsRaw)) {
      for (const entry of toolsRaw) {
        if (!entry || typeof entry !== "object") continue;
        const tool = entry as Record<string, unknown>;
        const name = typeof tool["name"] === "string" ? tool["name"] : undefined;
        if (!name) continue;
        const description =
          typeof tool["description"] === "string" ? tool["description"] : undefined;
        const inputSchema = tool["inputSchema"];
        tools.push({ name, description, inputSchema });
      }
    }

    const nextCursor =
      typeof record["nextCursor"] === "string" ? (record["nextCursor"] as string) : undefined;

    return { tools, nextCursor };
  }

  async toolsCall(name: string, args: Record<string, unknown> = {}): Promise<McpToolsCallResult> {
    const result = await this.request("tools/call", {
      name,
      arguments: args,
    });

    if (!result || typeof result !== "object") {
      return { content: [], isError: true };
    }
    const record = result as Record<string, unknown>;
    const content = Array.isArray(record["content"]) ? (record["content"] as unknown[]) : [];
    const isError = typeof record["isError"] === "boolean" ? (record["isError"] as boolean) : undefined;
    return { content, isError };
  }
}
