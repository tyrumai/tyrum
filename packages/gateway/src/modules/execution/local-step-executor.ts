import type { ActionPrimitive as ActionPrimitiveT, EvaluationContext } from "@tyrum/schemas";
import { spawn } from "node:child_process";
import { isBlockedUrl, resolvesToBlockedAddress, sanitizeEnv } from "../agent/tool-executor.js";
import type { ArtifactStore } from "../artifact/store.js";
import type { Logger } from "../observability/logger.js";
import type { PolicyService } from "../policy/service.js";
import type { RedactionEngine } from "../redaction/engine.js";
import type { SecretProvider } from "../secret/provider.js";
import type { StepExecutionContext, StepExecutor, StepResult } from "./engine.js";
import { maybeEnforceLocalExecutorPolicy } from "./local-step-executor-policy.js";
import { parsePlaybookOutputContract, resolveMaxOutputBytes } from "./playbook-output-contract.js";
import {
  enforceJsonOutputContract,
  assertSandboxed,
  readTextWithLimit,
  parseHeaderObject,
  isLikelyJson,
  isLikelyHtml,
  tryParseJson,
  resolveSecrets,
} from "./local-step-executor-helpers.js";

const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
const MAX_EXEC_TIMEOUT_MS = 300_000;

export interface LocalStepExecutorOptions {
  tyrumHome: string;
  secretProvider?: SecretProvider;
  policyService?: PolicyService;
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
  private readonly policyService?: PolicyService;
  private readonly redactionEngine?: RedactionEngine;
  private readonly artifactStore?: ArtifactStore;
  private readonly logger?: Logger;

  constructor(opts: LocalStepExecutorOptions) {
    this.tyrumHome = opts.tyrumHome;
    this.secretProvider = opts.secretProvider;
    this.policyService = opts.policyService;
    this.redactionEngine = opts.redactionEngine;
    this.artifactStore = opts.artifactStore;
    this.logger = opts.logger;
  }

  async execute(
    action: ActionPrimitiveT,
    planId: string,
    stepIndex: number,
    timeoutMs: number,
    context: StepExecutionContext,
  ): Promise<StepResult> {
    const policyResult = await maybeEnforceLocalExecutorPolicy({
      action,
      context,
      policyService: this.policyService,
      secretProvider: this.secretProvider,
    });
    if (policyResult) {
      return policyResult;
    }

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
    const timeoutMs =
      typeof timeoutMsRaw === "number" && Number.isFinite(timeoutMsRaw)
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

      const maxOutputBytes = resolveMaxOutputBytes(args);
      const contentType = response.headers.get("content-type");
      const { text: bodyText, truncated } = await readTextWithLimit(response, maxOutputBytes);

      const evidence: EvaluationContext = { http: { status: response.status } };
      const result = {
        ok: true,
        type: action.type,
        url,
        method,
        status: response.status,
        content_type: contentType ?? undefined,
        truncated,
      };

      const outputContract = parsePlaybookOutputContract(args);
      const contract = enforceJsonOutputContract(
        outputContract,
        bodyText,
        "response body",
        truncated,
      );
      if (contract.parsed !== undefined) {
        evidence.json = contract.parsed;
      }
      if (contract.error) {
        return { success: false, error: contract.error, result, evidence };
      }

      if (contract.parsed === undefined) {
        if (isLikelyJson(contentType, bodyText)) {
          const parsed = tryParseJson(bodyText);
          if (parsed !== undefined) {
            evidence.json = parsed;
          }
        }
        if (isLikelyHtml(contentType, bodyText)) {
          evidence.dom = { html: bodyText };
        }
      }

      return {
        success: true,
        result,
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
    const timeoutMs =
      typeof timeoutMsRaw === "number" && Number.isFinite(timeoutMsRaw)
        ? Math.max(1, Math.min(stepCapMs, Math.min(MAX_EXEC_TIMEOUT_MS, Math.floor(timeoutMsRaw))))
        : Math.min(stepCapMs, DEFAULT_EXEC_TIMEOUT_MS);
    const maxOutputBytes = resolveMaxOutputBytes(args);

    const output = await new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
      truncated: boolean;
      stdoutTruncated: boolean;
      stderrTruncated: boolean;
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
      let stdoutTruncated = false;
      let stderrTruncated = false;

      const pushLimited = (
        data: Buffer,
        chunks: Buffer[],
        size: number,
      ): { size: number; truncated: boolean } => {
        if (size >= maxOutputBytes) return { size, truncated: true };
        const remaining = maxOutputBytes - size;
        if (data.length <= remaining) {
          chunks.push(data);
          return { size: size + data.length, truncated: false };
        }
        chunks.push(data.subarray(0, remaining));
        return { size: size + remaining, truncated: true };
      };

      child.stdout.on("data", (data: Buffer) => {
        const next = pushLimited(data, stdoutChunks, stdoutSize);
        stdoutSize = next.size;
        stdoutTruncated ||= next.truncated;
      });
      child.stderr.on("data", (data: Buffer) => {
        const next = pushLimited(data, stderrChunks, stderrSize);
        stderrSize = next.size;
        stderrTruncated ||= next.truncated;
      });

      const timer = setTimeout(() => {
        try {
          child.kill("SIGTERM");
        } catch (err) {
          // Intentional: process may have already exited.
          void err;
        }
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch (err) {
            // Intentional: process may have already exited.
            void err;
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
          truncated: stdoutTruncated || stderrTruncated,
          stdoutTruncated,
          stderrTruncated,
        });
      });

      child.once("error", (err) => {
        clearTimeout(timer);
        resolvePromise({
          exitCode: null,
          signal: null,
          stdout: "",
          stderr: err.message,
          truncated: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        });
      });
    });

    const exitCode = output.exitCode;
    const result = {
      ok: exitCode === 0 && !output.signal,
      exit_code: exitCode,
      signal: output.signal ?? undefined,
      stdout: output.stdout,
      stderr: output.stderr,
      truncated: output.truncated,
      stdout_truncated: output.stdoutTruncated,
      stderr_truncated: output.stderrTruncated,
    };

    const artifacts = await this.tryStoreCliArtifact({
      planId,
      stepIndex,
      cmd,
      args: cmdArgs,
      cwd: cwdRaw,
      result,
    });

    const fallbackEvidence = {
      exit_code: exitCode,
      signal: output.signal ?? undefined,
      stdout: output.stdout,
      stderr: output.stderr,
    };
    const outputContract = parsePlaybookOutputContract(args);
    const contract = enforceJsonOutputContract(
      outputContract,
      output.stdout,
      "stdout",
      output.stdoutTruncated,
    );
    const parsedStdout = tryParseJson(output.stdout);
    const evidenceJson =
      contract.parsed !== undefined
        ? contract.parsed
        : parsedStdout !== undefined
          ? parsedStdout
          : fallbackEvidence;

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
    if (contract.error) {
      return {
        success: false,
        error: contract.error,
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
