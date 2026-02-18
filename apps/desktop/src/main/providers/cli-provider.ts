import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import type { ActionPrimitive, ClientCapability } from "@tyrum/schemas";
import { evaluatePostcondition, PostconditionError } from "@tyrum/schemas";
import type { EvaluationContext } from "@tyrum/schemas";
import type { CapabilityProvider, TaskResult } from "@tyrum/client";

const MAX_OUTPUT_BYTES = 1_000_000; // 1MB output cap
const DEFAULT_TIMEOUT_MS = 30_000;

export class CliProvider implements CapabilityProvider {
  readonly capability: ClientCapability = "cli";

  constructor(
    private allowedCommands: string[],
    private allowedWorkingDirs: string[],
    private allowlistEnforced = true,
  ) {}

  async execute(action: ActionPrimitive): Promise<TaskResult> {
    const args = action.args as Record<string, unknown>;
    const cmd = args["cmd"] as string | undefined;
    const cmdArgs = (args["args"] as string[] | undefined) ?? [];
    const cwd = args["cwd"] as string | undefined;
    const timeoutMs =
      (args["timeout_ms"] as number | undefined) ?? DEFAULT_TIMEOUT_MS;

    if (!cmd) {
      return { success: false, error: "Missing 'cmd' in CLI action args" };
    }

    // Allowlist enforcement
    if (this.allowlistEnforced && !this.allowedCommands.includes(cmd)) {
      return {
        success: false,
        error: `Command "${cmd}" is not in the allowlist. Allowed: ${this.allowedCommands.join(", ")}`,
      };
    }

    if (this.allowlistEnforced && cwd) {
      const resolvedCwd = resolve(cwd);
      const allowed = this.allowedWorkingDirs.some((dir) => {
        const allowedDir = resolve(dir);
        const rel = relative(allowedDir, resolvedCwd);
        return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
      });
      if (!allowed) {
        return {
          success: false,
          error: `Working directory "${cwd}" is not in the allowlist`,
        };
      }
    }

    return new Promise<TaskResult>((resolveResult) => {
      const start = Date.now();
      const child = spawn(cmd, cmdArgs, {
        cwd,
        timeout: timeoutMs,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data: Buffer) => {
        if (stdout.length < MAX_OUTPUT_BYTES) stdout += data.toString();
      });

      child.stderr?.on("data", (data: Buffer) => {
        if (stderr.length < MAX_OUTPUT_BYTES) stderr += data.toString();
      });

      child.on("close", (code) => {
        const evidence: Record<string, unknown> = {
          exit_code: code,
          stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
          stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
          duration_ms: Date.now() - start,
        };

        // If the command itself failed, skip postcondition evaluation
        if (code !== 0) {
          resolveResult({
            success: false,
            evidence,
            error: `Process exited with code ${code}`,
          });
          return;
        }

        // Evaluate postcondition if present
        if (action.postcondition != null) {
          try {
            // Try to parse stdout as JSON for json_path assertions
            let jsonContext: unknown;
            try {
              jsonContext = JSON.parse(stdout);
            } catch {
              // stdout is not JSON — that's fine, json_path assertions will
              // fail with missing_evidence which we catch below
            }

            const evalContext: EvaluationContext = {
              json: jsonContext,
            };

            const report = evaluatePostcondition(
              action.postcondition,
              evalContext,
            );
            evidence.postcondition = report;

            if (!report.passed) {
              resolveResult({
                success: false,
                evidence,
                error: `Command succeeded but postcondition failed: ${report.assertions
                  .filter((a) => a.status === "failed")
                  .map((a) => a.message)
                  .join("; ")}`,
              });
              return;
            }
          } catch (err) {
            if (err instanceof PostconditionError) {
              evidence.postcondition = { passed: false, error: err.message };
              resolveResult({
                success: false,
                evidence,
                error: `Postcondition evaluation error: ${err.message}`,
              });
              return;
            }
            const message = err instanceof Error ? err.message : String(err);
            evidence.postcondition = { passed: false, error: message };
            resolveResult({
              success: false,
              evidence,
              error: `Unexpected postcondition error: ${message}`,
            });
            return;
          }
        }

        resolveResult({ success: true, evidence });
      });

      child.on("error", (err) => {
        resolveResult({
          success: false,
          error: err.message,
        });
      });
    });
  }
}
