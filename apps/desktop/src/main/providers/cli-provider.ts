import { spawn } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import type { ActionPrimitive, ClientCapability } from "@tyrum/operator-core";
import { checkPostcondition } from "@tyrum/operator-core";
import type { EvaluationContext } from "@tyrum/operator-core";
import type { CapabilityProvider, TaskResult } from "@tyrum/operator-core";

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

type ParsedCliActionArgs = {
  cmd: string;
  cmdArgs: string[];
  cwd: string | undefined;
  stdin: string | undefined;
  outputKind: OutputKind | undefined;
  timeoutMs: number;
};

type SpawnedProcessOutput = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
};

function parseCliActionArgs(action: ActionPrimitive): ParsedCliActionArgs | TaskResult {
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

  return {
    cmd,
    cmdArgs,
    cwd,
    stdin,
    outputKind,
    timeoutMs,
  };
}

function checkCommandAllowlist(options: {
  allowlistEnforced: boolean;
  allowedCommands: string[];
  cmd: string;
  cmdArgs: string[];
}): TaskResult | null {
  if (!options.allowlistEnforced) return null;
  if (isCommandAllowed(options.allowedCommands, options.cmd, options.cmdArgs)) return null;

  const normalizedAllowlist = normalizeLines(options.allowedCommands);
  const shownAllowlist =
    normalizedAllowlist.length > 0 ? normalizedAllowlist.join(", ") : "(empty: default deny)";
  return {
    success: false,
    error:
      `CLI allowlist is active (default deny). ` +
      `Command "${formatCommand(options.cmd, options.cmdArgs)}" is not in the allowlist. ` +
      `Allowed: ${shownAllowlist}. ` +
      `Use "*" to allow everything.`,
  };
}

function checkWorkingDirAllowlist(options: {
  allowlistEnforced: boolean;
  allowedWorkingDirs: string[];
  cwd: string | undefined;
}): TaskResult | null {
  if (!options.allowlistEnforced) return null;
  if (!options.cwd) return null;

  const normalizedAllowedDirs = normalizeLines(options.allowedWorkingDirs);
  if (normalizedAllowedDirs.length === 0) {
    return {
      success: false,
      error:
        `CLI working-directory allowlist is active (default deny) and empty. ` +
        `Either add allowed directories or use "*" to allow all directories.`,
    };
  }

  const resolvedCwd = resolve(options.cwd);
  const allowed = normalizedAllowedDirs.some((dir) => {
    if (dir === "*") return true;
    const allowedDir = resolve(dir);
    const rel = relative(allowedDir, resolvedCwd);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
  if (allowed) return null;

  return {
    success: false,
    error: `Working directory "${options.cwd}" is not in the allowlist`,
  };
}

function appendOutput(current: string, data: Buffer): string {
  if (current.length < MAX_OUTPUT_BYTES) {
    return current + data.toString();
  }
  return current;
}

function writeChildStdin(child: ReturnType<typeof spawn>, stdin: string | undefined): void {
  const stdinStream = child.stdin;
  // Child may exit before consuming stdin; ignore resulting pipe stream errors.
  stdinStream?.on("error", () => undefined);

  if (stdin !== undefined) {
    stdinStream?.write(stdin);
  }
  stdinStream?.end();
}

function spawnCommand(options: {
  cmd: string;
  cmdArgs: string[];
  cwd: string | undefined;
  stdin: string | undefined;
  timeoutMs: number;
}): Promise<SpawnedProcessOutput> {
  return new Promise((resolvePromise, rejectPromise) => {
    const start = Date.now();
    const child = spawn(options.cmd, options.cmdArgs, {
      cwd: options.cwd,
      timeout: options.timeoutMs,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    writeChildStdin(child, options.stdin);

    child.stdout?.on("data", (data: Buffer) => {
      stdout = appendOutput(stdout, data);
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr = appendOutput(stderr, data);
    });

    child.once("close", (code) => {
      resolvePromise({
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - start,
      });
    });

    child.once("error", (err) => {
      rejectPromise(err);
    });
  });
}

function evaluateProcessOutput(options: {
  output: SpawnedProcessOutput;
  outputKind: OutputKind | undefined;
  postcondition: ActionPrimitive["postcondition"];
}): TaskResult {
  const evidence: Record<string, unknown> = {
    exit_code: options.output.exitCode,
    stdout: options.output.stdout.slice(0, MAX_OUTPUT_BYTES),
    stderr: options.output.stderr.slice(0, MAX_OUTPUT_BYTES),
    duration_ms: options.output.durationMs,
  };

  // If the command itself failed, skip postcondition evaluation
  if (options.output.exitCode !== 0) {
    return {
      success: false,
      evidence,
      error: `Process exited with code ${options.output.exitCode}`,
    };
  }

  // Output contract enforcement (json output must parse).
  let jsonContext: unknown;
  let jsonParseError: string | undefined;
  try {
    jsonContext = JSON.parse(options.output.stdout);
  } catch (err) {
    jsonParseError = err instanceof Error ? err.message : String(err);
  }

  if (options.outputKind === "json") {
    if (jsonParseError) {
      evidence.json_parse_error = jsonParseError;
      return {
        success: false,
        evidence,
        error: `Output contract violated: expected JSON stdout`,
      };
    }
    evidence.json = jsonContext;
  }

  // Evaluate postcondition if present
  if (options.postcondition != null) {
    const evalContext: EvaluationContext = {
      json: jsonParseError ? undefined : jsonContext,
    };

    const postcondResult = checkPostcondition(options.postcondition, evalContext);
    if (postcondResult.report) {
      evidence.postcondition = postcondResult.report;
    }

    if (!postcondResult.passed) {
      evidence.postcondition ??= { passed: false, error: postcondResult.error };
      return {
        success: false,
        evidence,
        error: postcondResult.error ?? "postcondition failed",
      };
    }
  }

  return { success: true, evidence };
}

export class CliProvider implements CapabilityProvider {
  readonly capability: ClientCapability = "cli";

  constructor(
    private allowedCommands: string[],
    private allowedWorkingDirs: string[],
    private allowlistEnforced = true,
  ) {}

  async execute(action: ActionPrimitive): Promise<TaskResult> {
    const parsed = parseCliActionArgs(action);
    if (!("cmd" in parsed)) return parsed;

    // Allowlist enforcement
    const allowlistError = checkCommandAllowlist({
      allowlistEnforced: this.allowlistEnforced,
      allowedCommands: this.allowedCommands,
      cmd: parsed.cmd,
      cmdArgs: parsed.cmdArgs,
    });
    if (allowlistError) return allowlistError;

    const workingDirError = checkWorkingDirAllowlist({
      allowlistEnforced: this.allowlistEnforced,
      allowedWorkingDirs: this.allowedWorkingDirs,
      cwd: parsed.cwd,
    });
    if (workingDirError) return workingDirError;

    try {
      const output = await spawnCommand({
        cmd: parsed.cmd,
        cmdArgs: parsed.cmdArgs,
        cwd: parsed.cwd,
        stdin: parsed.stdin,
        timeoutMs: parsed.timeoutMs,
      });
      return evaluateProcessOutput({
        output,
        outputKind: parsed.outputKind,
        postcondition: action.postcondition,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return { success: false, error: error.message };
    }
  }
}
