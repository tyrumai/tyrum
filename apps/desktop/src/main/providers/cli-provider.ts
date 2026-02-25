import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import type { ActionPrimitive, ClientCapability } from "@tyrum/schemas";
import { checkPostcondition } from "@tyrum/schemas";
import type { EvaluationContext } from "@tyrum/schemas";
import type { CapabilityProvider, TaskResult } from "@tyrum/client";

const MAX_OUTPUT_BYTES = 1_000_000; // 1MB output cap
const DEFAULT_TIMEOUT_MS = 30_000;

type OutputKind = "text" | "json";

function outputKindFromArgs(args: Record<string, unknown>): OutputKind | undefined {
  const direct = args["output"];
  const meta =
    args["__playbook"] &&
    typeof args["__playbook"] === "object" &&
    !Array.isArray(args["__playbook"])
      ? (args["__playbook"] as Record<string, unknown>)["output"]
      : undefined;
  const output = meta ?? direct;

  if (output === "json") return "json";
  if (output === "text") return "text";
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const type = (output as Record<string, unknown>)["type"];
    if (type === "json") return "json";
    if (type === "text") return "text";
  }
  return undefined;
}

function normalizeLines(values: string[]): string[] {
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function isCommandAllowed(allowlist: string[], cmd: string, cmdArgs: string[]): boolean {
  const normalized = normalizeLines(allowlist);
  if (normalized.includes("*")) return true;

  return normalized.some((entry) => {
    const tokens = entry.split(/\s+/g);
    if (tokens.length === 0 || tokens[0] !== cmd) return false;
    if (tokens.length === 1) return true;
    const requiredArgs = tokens.slice(1);
    if (cmdArgs.length < requiredArgs.length) return false;
    return requiredArgs.every((token, idx) => cmdArgs[idx] === token);
  });
}

function formatCommand(cmd: string, cmdArgs: string[]): string {
  return [cmd, ...cmdArgs].join(" ").trim();
}

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
    const stdin = args["stdin"] as string | undefined;
    const outputKind = outputKindFromArgs(args);
    const timeoutMs = (args["timeout_ms"] as number | undefined) ?? DEFAULT_TIMEOUT_MS;

    if (!cmd) {
      return { success: false, error: "Missing 'cmd' in CLI action args" };
    }

    // Allowlist enforcement
    if (this.allowlistEnforced && !isCommandAllowed(this.allowedCommands, cmd, cmdArgs)) {
      const normalizedAllowlist = normalizeLines(this.allowedCommands);
      const shownAllowlist =
        normalizedAllowlist.length > 0 ? normalizedAllowlist.join(", ") : "(empty: default deny)";
      return {
        success: false,
        error:
          `CLI allowlist is active (default deny). ` +
          `Command "${formatCommand(cmd, cmdArgs)}" is not in the allowlist. ` +
          `Allowed: ${shownAllowlist}. ` +
          `Use "*" to allow everything.`,
      };
    }

    if (this.allowlistEnforced && cwd) {
      const normalizedAllowedDirs = normalizeLines(this.allowedWorkingDirs);
      if (normalizedAllowedDirs.length === 0) {
        return {
          success: false,
          error:
            `CLI working-directory allowlist is active (default deny) and empty. ` +
            `Either add allowed directories or use "*" to allow all directories.`,
        };
      }

      const resolvedCwd = resolve(cwd);
      const allowed = normalizedAllowedDirs.some((dir) => {
        if (dir === "*") return true;
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
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      const stdinStream = child.stdin;
      // Child may exit before consuming stdin; ignore resulting pipe stream errors.
      stdinStream?.on("error", () => undefined);

      if (stdin !== undefined) {
        stdinStream?.write(stdin);
      }
      stdinStream?.end();

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

        // Output contract enforcement (json output must parse).
        let jsonContext: unknown;
        let jsonParseError: string | undefined;
        try {
          jsonContext = JSON.parse(stdout);
        } catch (err) {
          jsonParseError = err instanceof Error ? err.message : String(err);
        }

        if (outputKind === "json") {
          if (jsonParseError) {
            evidence.json_parse_error = jsonParseError;
            resolveResult({
              success: false,
              evidence,
              error: `Output contract violated: expected JSON stdout`,
            });
            return;
          }
          evidence.json = jsonContext;
        }

        // Evaluate postcondition if present
        if (action.postcondition != null) {
          const evalContext: EvaluationContext = {
            json: jsonParseError ? undefined : jsonContext,
          };

          const postcondResult = checkPostcondition(action.postcondition, evalContext);
          if (postcondResult.report) {
            evidence.postcondition = postcondResult.report;
          }

          if (!postcondResult.passed) {
            evidence.postcondition ??= { passed: false, error: postcondResult.error };
            resolveResult({
              success: false,
              evidence,
              error: postcondResult.error ?? "postcondition failed",
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
