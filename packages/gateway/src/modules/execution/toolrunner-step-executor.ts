import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/schemas";
import { spawn } from "node:child_process";
import type { Logger } from "../observability/logger.js";
import type { StepExecutionContext, StepExecutor, StepResult } from "./engine.js";

// Transport ceiling for toolrunner JSON over stdio. This must be high enough
// to carry the largest StepResult payload without truncating JSON.
const MAX_STDIO_BYTES = 4 * 1024 * 1024;

export interface ToolRunnerStepExecutorOptions {
  entrypoint: string;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
}

export function createToolRunnerStepExecutor(opts: ToolRunnerStepExecutorOptions): StepExecutor {
  return new ToolRunnerStepExecutor(opts);
}

class ToolRunnerStepExecutor implements StepExecutor {
  private readonly entrypoint: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly logger?: Logger;

  constructor(opts: ToolRunnerStepExecutorOptions) {
    this.entrypoint = opts.entrypoint;
    this.env = opts.env ?? process.env;
    this.logger = opts.logger;
  }

  async execute(
    action: ActionPrimitiveT,
    planId: string,
    stepIndex: number,
    timeoutMs: number,
    _context: StepExecutionContext,
  ): Promise<StepResult> {
    const payload = JSON.stringify({
      plan_id: planId,
      step_index: stepIndex,
      timeout_ms: timeoutMs,
      action,
    });

    const startedAt = Date.now();

    return await new Promise<StepResult>((resolve) => {
      const child = spawn(process.execPath, [...process.execArgv, this.entrypoint, "toolrunner"], {
        env: { ...this.env, TYRUM_TOOLRUNNER_MODE: "1", TYRUM_LOG_LEVEL: "silent" },
        stdio: ["pipe", "pipe", "pipe"],
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
        if (size >= MAX_STDIO_BYTES) return { size, truncated: true };
        const remaining = MAX_STDIO_BYTES - size;
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

      const killTimer = setTimeout(
        () => {
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
        },
        Math.max(1, Math.floor(timeoutMs)),
      );
      killTimer.unref();

      child.once("close", (code, signal) => {
        clearTimeout(killTimer);
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8").trim();
        const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
        const durationMs = Math.max(0, Date.now() - startedAt);
        const transportTruncated = stdoutTruncated || stderrTruncated;

        if (signal) {
          resolve({
            success: false,
            error: `toolrunner terminated by signal ${signal}`,
            cost: { duration_ms: durationMs },
          });
          return;
        }

        if (code !== 0) {
          this.logger?.warn("toolrunner.failed", { exit_code: code, stderr });
          resolve({
            success: false,
            error: stderr || `toolrunner exited with code ${String(code)}`,
            cost: { duration_ms: durationMs },
          });
          return;
        }

        if (transportTruncated) {
          this.logger?.warn("toolrunner.transport_truncated", {
            stdout_truncated: stdoutTruncated,
            stderr_truncated: stderrTruncated,
            max_stdio_bytes: MAX_STDIO_BYTES,
          });
          resolve({
            success: false,
            error: `toolrunner transport exceeded ${String(MAX_STDIO_BYTES)} bytes`,
            cost: { duration_ms: durationMs },
          });
          return;
        }

        try {
          const parsed = JSON.parse(stdout) as StepResult;
          resolve(parsed);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          resolve({
            success: false,
            error: `toolrunner returned invalid json: ${message}`,
            cost: { duration_ms: durationMs },
          });
        }
      });

      child.once("error", (err) => {
        clearTimeout(killTimer);
        resolve({ success: false, error: `toolrunner spawn error: ${err.message}` });
      });

      try {
        child.stdin.write(payload, "utf-8");
        child.stdin.end();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        resolve({ success: false, error: `toolrunner stdin error: ${message}` });
      }
    });
  }
}
