import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { CapabilityProvider, TaskResult, TaskExecuteContext } from "@tyrum/client";
import type { ActionPrimitive } from "@tyrum/contracts";
import { FilesystemActionArgs, FILESYSTEM_CAPABILITY_IDS } from "@tyrum/contracts";
import {
  assertSandboxed,
  truncateOutput,
  selectReadContent,
  replaceExactString,
  applyPatch,
  execBash,
  globFiles,
  grepFiles,
} from "./filesystem-provider-helpers.js";
import type {
  FsReadArgs,
  FsWriteArgs,
  FsEditArgs,
  FsApplyPatchArgs,
  FsBashArgs,
  FsGlobArgs,
  FsGrepArgs,
} from "@tyrum/contracts";

const FILESYSTEM_BASH_CAPABILITY_ID = "tyrum.fs.bash";
const FILESYSTEM_CAPABILITY_IDS_WITHOUT_BASH = FILESYSTEM_CAPABILITY_IDS.filter(
  (id) => id !== FILESYSTEM_BASH_CAPABILITY_ID,
);

export interface FilesystemProviderConfig {
  /** Root directory for file operations; bash cwd defaults here but shell access is not path-confined. */
  sandboxRoot: string;
  /**
   * Enable `tyrum.fs.bash`.
   * Only use when the runtime already has a real OS/container sandbox.
   */
  allowBash?: boolean;
  /** Max output bytes (default 32_768). */
  maxResponseBytes?: number;
  /** Default bash timeout in ms (default 30_000). */
  defaultExecTimeoutMs?: number;
  /** Max bash timeout in ms (default 300_000). */
  maxExecTimeoutMs?: number;
}

export function resolveFilesystemCapabilityIds(input?: { allowBash?: boolean }): readonly string[] {
  return input?.allowBash ? FILESYSTEM_CAPABILITY_IDS : FILESYSTEM_CAPABILITY_IDS_WITHOUT_BASH;
}

export class FilesystemProvider implements CapabilityProvider {
  readonly capabilityIds: readonly string[];

  private readonly sandboxRoot: string;
  private readonly allowBash: boolean;
  private readonly maxResponseBytes: number;
  private readonly defaultExecTimeoutMs: number;
  private readonly maxExecTimeoutMs: number;

  constructor(config: FilesystemProviderConfig) {
    this.sandboxRoot = resolve(config.sandboxRoot);
    this.allowBash = config.allowBash ?? false;
    this.capabilityIds = resolveFilesystemCapabilityIds({ allowBash: this.allowBash });
    this.maxResponseBytes = config.maxResponseBytes ?? 32_768;
    this.defaultExecTimeoutMs = config.defaultExecTimeoutMs ?? 30_000;
    this.maxExecTimeoutMs = config.maxExecTimeoutMs ?? 300_000;
  }

  async execute(action: ActionPrimitive, _ctx?: TaskExecuteContext): Promise<TaskResult> {
    const parsed = FilesystemActionArgs.safeParse(action.args);
    if (!parsed.success) {
      return { success: false, error: `Invalid filesystem args: ${parsed.error.message}` };
    }
    try {
      switch (parsed.data.op) {
        case "read":
          return await this.read(parsed.data);
        case "write":
          return await this.write(parsed.data);
        case "edit":
          return await this.edit(parsed.data);
        case "apply_patch":
          return await this.applyPatch(parsed.data);
        case "bash":
          if (!this.allowBash) {
            return {
              success: false,
              error:
                "Filesystem bash is disabled. Enable it only when the runtime already provides OS/container sandboxing.",
            };
          }
          return await this.bash(parsed.data);
        case "glob":
          return await this.glob(parsed.data);
        case "grep":
          return await this.grep(parsed.data);
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private safe(filePath: string): string {
    return assertSandboxed(this.sandboxRoot, filePath);
  }

  private rel(absolutePath: string): string {
    const r = relative(this.sandboxRoot, absolutePath);
    return r.length > 0 ? r : ".";
  }

  private async read(args: FsReadArgs): Promise<TaskResult> {
    const safePath = this.safe(args.path);
    const content = await readFile(safePath, "utf-8");
    const selected = selectReadContent(content, args.offset, args.limit);
    const truncated = Buffer.byteLength(selected, "utf-8") > this.maxResponseBytes;
    const output = truncated ? truncateOutput(selected, this.maxResponseBytes) : selected;
    return {
      success: true,
      result: {
        content: output,
        path: this.rel(safePath),
        raw_chars: content.length,
        selected_chars: selected.length,
        truncated,
      },
    };
  }

  private async write(args: FsWriteArgs): Promise<TaskResult> {
    const safePath = this.safe(args.path);
    await mkdir(dirname(safePath), { recursive: true });
    await writeFile(safePath, args.content, "utf-8");
    return {
      success: true,
      result: { path: this.rel(safePath), bytes_written: Buffer.byteLength(args.content, "utf-8") },
    };
  }

  private async edit(args: FsEditArgs): Promise<TaskResult> {
    const safePath = this.safe(args.path);
    const content = await readFile(safePath, "utf-8");
    const { updated, replacements } = replaceExactString({
      content,
      oldString: args.old_string,
      newString: args.new_string,
      replaceAll: args.replace_all ?? false,
    });
    await writeFile(safePath, updated, "utf-8");
    return { success: true, result: { path: this.rel(safePath), replacements } };
  }

  private async applyPatch(args: FsApplyPatchArgs): Promise<TaskResult> {
    const applied = await applyPatch(this.sandboxRoot, args.patch);
    return { success: true, result: { applied } };
  }

  private async bash(args: FsBashArgs): Promise<TaskResult> {
    const cwd = this.safe(args.cwd ?? ".");
    const timeoutMs =
      args.timeout_ms !== undefined
        ? Math.max(1, Math.min(this.maxExecTimeoutMs, args.timeout_ms))
        : this.defaultExecTimeoutMs;
    const { output, exitCode } = await execBash(
      args.command,
      cwd,
      timeoutMs,
      this.maxResponseBytes,
    );
    return {
      success: true,
      result: { output: truncateOutput(output, this.maxResponseBytes), exit_code: exitCode },
    };
  }

  private async glob(args: FsGlobArgs): Promise<TaskResult> {
    const basePath = this.safe(args.path ?? ".");
    const matches = await globFiles(basePath, args.pattern);
    return { success: true, result: { matches } };
  }

  private async grep(args: FsGrepArgs): Promise<TaskResult> {
    const basePath = this.safe(args.path ?? ".");
    const matches = await grepFiles(basePath, args.pattern, {
      include: args.include,
      regex: args.regex,
      ignoreCase: args.ignore_case,
    });
    return { success: true, result: { matches } };
  }
}
