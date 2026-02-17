import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { ActionPrimitive, ClientCapability } from "@tyrum/schemas";
import type { CapabilityProvider, TaskResult } from "@tyrum/client";

const MAX_OUTPUT_BYTES = 1_000_000; // 1MB output cap
const DEFAULT_TIMEOUT_MS = 30_000;

export class CliProvider implements CapabilityProvider {
  readonly capability: ClientCapability = "cli";

  constructor(
    private allowedCommands: string[],
    private allowedWorkingDirs: string[],
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
    if (!this.allowedCommands.includes(cmd)) {
      return {
        success: false,
        error: `Command "${cmd}" is not in the allowlist. Allowed: ${this.allowedCommands.join(", ")}`,
      };
    }

    if (cwd) {
      const resolved = resolve(cwd);
      const allowed = this.allowedWorkingDirs.some((dir) =>
        resolved.startsWith(resolve(dir)),
      );
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
        resolveResult({
          success: code === 0,
          evidence: {
            exit_code: code,
            stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
            stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
            duration_ms: Date.now() - start,
          },
          error: code !== 0 ? `Process exited with code ${code}` : undefined,
        });
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
