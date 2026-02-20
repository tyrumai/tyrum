import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/schemas";
import type { EvaluationContext } from "@tyrum/schemas";
import { spawn } from "node:child_process";
import { resolve, relative, isAbsolute } from "node:path";
import { isBlockedUrl, resolvesToBlockedAddress, sanitizeEnv } from "../agent/tool-executor.js";
import type { ArtifactStore } from "../artifact/store.js";
import type { Logger } from "../observability/logger.js";
import type { RedactionEngine } from "../redaction/engine.js";
import type { SecretProvider } from "../secret/provider.js";
import type { StepExecutor, StepResult } from "./engine.js";

const MAX_OUTPUT_BYTES = 32_768;
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
const MAX_EXEC_TIMEOUT_MS = 300_000;
const SECRET_HANDLE_PREFIX = "secret:";

function assertSandboxed(baseDir: string, filePath: string): string {
  const resolvedBase = resolve(baseDir);
  const resolvedPath = resolve(resolvedBase, filePath);
  const rel = relative(resolvedBase, resolvedPath);

  if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
    throw new Error(`path escapes workspace: ${filePath}`);
  }
  return resolvedPath;
}

async function readTextWithLimit(
  response: Response,
  limitBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const body = response.body;
  if (!body) {
    return { text: "", truncated: false };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      const remaining = limitBytes - total;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      if (value.length <= remaining) {
        chunks.push(value);
        total += value.length;
      } else {
        chunks.push(value.subarray(0, remaining));
        total += remaining;
        truncated = true;
        break;
      }
    }
  } finally {
    if (truncated) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  const decoder = new TextDecoder("utf-8");
  return { text: decoder.decode(merged), truncated };
}

function parseHeaderObject(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") headers[k] = v;
  }
  return headers;
}

function isLikelyJson(contentType: string | null, body: string): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("application/json") || ct.endsWith("+json")) return true;
  const trimmed = body.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function isLikelyHtml(contentType: string | null, body: string): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("text/html") || ct.includes("application/xhtml+xml")) return true;
  return body.trimStart().startsWith("<");
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
async function resolveSecrets(
  args: unknown,
  secretProvider: SecretProvider | undefined,
): Promise<{ resolved: unknown; secrets: string[] }> {
  if (!secretProvider) return { resolved: args, secrets: [] };

  const handles = await secretProvider.list();
  const handleById = new Map(handles.map((h) => [h.handle_id, h]));

  const secrets: string[] = [];

  const walk = async (value: unknown): Promise<unknown> => {
    if (typeof value === "string" && value.startsWith(SECRET_HANDLE_PREFIX)) {
      const handleId = value.slice(SECRET_HANDLE_PREFIX.length);
      const handle = handleById.get(handleId);
      const resolved = handle ? await secretProvider.resolve(handle) : null;
      if (resolved !== null) {
        secrets.push(resolved);
        return resolved;
      }
      return value;
    }

    if (Array.isArray(value)) {
      return Promise.all(value.map(walk));
    }

    if (value !== null && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      const out: Record<string, unknown> = {};
      for (const [k, v] of entries) {
        out[k] = await walk(v);
      }
      return out;
    }

    return value;
  };

  const resolved = await walk(args);
  return { resolved, secrets };
}

export interface LocalStepExecutorOptions {
  tyrumHome: string;
  secretProvider?: SecretProvider;
  redactionEngine?: RedactionEngine;
  artifactStore?: ArtifactStore;
  logger?: Logger;
}

export function createLocalStepExecutor(opts: LocalStepExecutorOptions): StepExecutor {
  return new LocalStepExecutor(opts);
}

class LocalStepExecutor implements StepExecutor {
  private readonly tyrumHome: string;
  private readonly secretProvider?: SecretProvider;
  private readonly redactionEngine?: RedactionEngine;
  private readonly artifactStore?: ArtifactStore;
  private readonly logger?: Logger;

  constructor(opts: LocalStepExecutorOptions) {
    this.tyrumHome = opts.tyrumHome;
    this.secretProvider = opts.secretProvider;
    this.redactionEngine = opts.redactionEngine;
    this.artifactStore = opts.artifactStore;
    this.logger = opts.logger;
  }

  async execute(
    action: ActionPrimitiveT,
    planId: string,
    stepIndex: number,
    timeoutMs: number,
  ): Promise<StepResult> {
    const { resolved, secrets } = await resolveSecrets(action.args ?? {}, this.secretProvider);
    if (secrets.length > 0) {
      this.redactionEngine?.registerSecrets(secrets);
    }

    switch (action.type) {
      case "Http":
        return this.executeHttp(
          action,
          resolved as Record<string, unknown>,
          planId,
          stepIndex,
          timeoutMs,
        );
      case "CLI":
        return this.executeCli(
          action,
          resolved as Record<string, unknown>,
          planId,
          stepIndex,
          timeoutMs,
        );
      default:
        return { success: false, error: `unsupported action type: ${action.type}` };
    }
  }

  private async executeHttp(
    action: ActionPrimitiveT,
    args: Record<string, unknown>,
    _planId: string,
    _stepIndex: number,
    stepTimeoutMs: number,
  ): Promise<StepResult> {
    const url = typeof args["url"] === "string" ? args["url"] : undefined;
    if (!url) return { success: false, error: "missing required argument: url" };

    if (isBlockedUrl(url) || (await resolvesToBlockedAddress(url))) {
      return {
        success: false,
        error: "blocked url: requests to private/internal network addresses are denied",
      };
    }

    const methodRaw = typeof args["method"] === "string" ? args["method"] : "GET";
    const method = methodRaw.trim().length > 0 ? methodRaw : "GET";
    const headers = parseHeaderObject(args["headers"]) ?? {};
    const body = typeof args["body"] === "string" ? args["body"] : undefined;
    const timeoutMsRaw = args["timeout_ms"];
    const stepCapMs = Math.max(1, Math.floor(stepTimeoutMs));
    const timeoutMs = typeof timeoutMsRaw === "number" && Number.isFinite(timeoutMsRaw)
      ? Math.max(1, Math.min(stepCapMs, Math.min(300_000, Math.floor(timeoutMsRaw))))
      : Math.min(stepCapMs, DEFAULT_HTTP_TIMEOUT_MS);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type");
      const { text: bodyText, truncated } = await readTextWithLimit(response, MAX_OUTPUT_BYTES);

      const evidence: EvaluationContext = { http: { status: response.status } };

      if (isLikelyJson(contentType, bodyText)) {
        const parsed = tryParseJson(bodyText);
        if (parsed !== undefined) {
          evidence.json = parsed;
        }
      }

      if (isLikelyHtml(contentType, bodyText)) {
        evidence.dom = { html: bodyText };
      }

      return {
        success: true,
        result: {
          ok: true,
          type: action.type,
          url,
          method,
          status: response.status,
          content_type: contentType ?? undefined,
          truncated,
        },
        evidence,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async executeCli(
    _action: ActionPrimitiveT,
    args: Record<string, unknown>,
    planId: string,
    stepIndex: number,
    stepTimeoutMs: number,
  ): Promise<StepResult> {
    const cmd = typeof args["cmd"] === "string" ? args["cmd"] : undefined;
    if (!cmd) return { success: false, error: "missing required argument: cmd" };

    const cmdArgs: string[] = Array.isArray(args["args"])
      ? (args["args"] as unknown[]).filter((v): v is string => typeof v === "string")
      : [];

    const cwdRaw = typeof args["cwd"] === "string" ? args["cwd"] : ".";
    const cwd = assertSandboxed(this.tyrumHome, cwdRaw);

    const stepCapMs = Math.max(1, Math.floor(stepTimeoutMs));
    const timeoutMsRaw = args["timeout_ms"];
    const timeoutMs = typeof timeoutMsRaw === "number" && Number.isFinite(timeoutMsRaw)
      ? Math.max(1, Math.min(stepCapMs, Math.min(MAX_EXEC_TIMEOUT_MS, Math.floor(timeoutMsRaw))))
      : Math.min(stepCapMs, DEFAULT_EXEC_TIMEOUT_MS);

    const output = await new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
    }>((resolvePromise) => {
      const child = spawn(cmd, cmdArgs, {
        cwd,
        env: sanitizeEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutSize = 0;
      let stderrSize = 0;

      const pushLimited = (
        data: Buffer,
        chunks: Buffer[],
        size: number,
      ): number => {
        if (size >= MAX_OUTPUT_BYTES) return size;
        const remaining = MAX_OUTPUT_BYTES - size;
        if (data.length <= remaining) {
          chunks.push(data);
          return size + data.length;
        }
        chunks.push(data.subarray(0, remaining));
        return size + remaining;
      };

      child.stdout.on("data", (data: Buffer) => {
        stdoutSize = pushLimited(data, stdoutChunks, stdoutSize);
      });
      child.stderr.on("data", (data: Buffer) => {
        stderrSize = pushLimited(data, stderrChunks, stderrSize);
      });

      const timer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore
          }
        }, 5_000).unref();
      }, timeoutMs);
      timer.unref();

      child.once("close", (exitCode, signal) => {
        clearTimeout(timer);
        resolvePromise({
          exitCode,
          signal,
          stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
          stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        });
      });

      child.once("error", (err) => {
        clearTimeout(timer);
        resolvePromise({
          exitCode: null,
          signal: null,
          stdout: "",
          stderr: err.message,
        });
      });
    });

    const exitCode = output.exitCode;
    const evidenceJson = (() => {
      const parsed = tryParseJson(output.stdout);
      if (parsed !== undefined) return parsed;
      return {
        exit_code: exitCode,
        signal: output.signal ?? undefined,
        stdout: output.stdout,
        stderr: output.stderr,
      };
    })();

    const result = {
      ok: exitCode === 0 && !output.signal,
      exit_code: exitCode,
      signal: output.signal ?? undefined,
      stdout: output.stdout,
      stderr: output.stderr,
    };

    const artifacts = await this.tryStoreCliArtifact({
      planId,
      stepIndex,
      cmd,
      args: cmdArgs,
      cwd: cwdRaw,
      result,
    });

    if (exitCode !== 0 || output.signal) {
      const message = output.signal
        ? `command terminated by signal ${output.signal}`
        : `command failed with exit code ${exitCode ?? "unknown"}`;
      return {
        success: false,
        error: message,
        result,
        evidence: { json: evidenceJson },
        artifacts,
      };
    }

    return {
      success: true,
      result,
      evidence: { json: evidenceJson },
      artifacts,
    };
  }

  private async tryStoreCliArtifact(input: {
    planId: string;
    stepIndex: number;
    cmd: string;
    args: string[];
    cwd: string;
    result: unknown;
  }): Promise<StepResult["artifacts"]> {
    if (!this.artifactStore) return undefined;

    try {
      const payload = {
        kind: "cli",
        plan_id: input.planId,
        step_index: input.stepIndex,
        cmd: input.cmd,
        args: input.args,
        cwd: input.cwd,
        result: input.result,
      };
      const ref = await this.artifactStore.put({
        kind: "log",
        body: Buffer.from(JSON.stringify(payload, null, 2), "utf8"),
        mime_type: "application/json",
        labels: ["cli", `plan:${input.planId}`, `step:${String(input.stepIndex)}`],
      });
      return [ref];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn("executor.artifact_store_failed", { error: message });
      return undefined;
    }
  }
}
