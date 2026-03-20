import {
  FsApplyPatchArgs,
  FsApplyPatchResult,
  FsBashArgs,
  FsBashResult,
  FsEditArgs,
  FsEditResult,
  FsGlobArgs,
  FsGlobResult,
  FsGrepArgs,
  FsGrepResult,
  FsReadArgs,
  FsReadResult,
  FsWriteArgs,
  FsWriteResult,
} from "@tyrum/contracts";
import { fa, type CapabilityCatalogEntry } from "./capability-catalog-helpers.js";

export const FILESYSTEM_CAPABILITY_CATALOG_ENTRIES: readonly CapabilityCatalogEntry[] = [
  fa("tyrum.fs.read", "read", "Read a file from the filesystem.", FsReadArgs, FsReadResult, false),
  fa("tyrum.fs.write", "write", "Write content to a file.", FsWriteArgs, FsWriteResult, true),
  fa("tyrum.fs.edit", "edit", "Edit a file by replacing text.", FsEditArgs, FsEditResult, true),
  fa(
    "tyrum.fs.apply-patch",
    "apply_patch",
    "Apply a structured patch.",
    FsApplyPatchArgs,
    FsApplyPatchResult,
    true,
  ),
  fa("tyrum.fs.bash", "bash", "Execute a shell command.", FsBashArgs, FsBashResult, true),
  fa("tyrum.fs.glob", "glob", "Find files by glob pattern.", FsGlobArgs, FsGlobResult, false),
  fa("tyrum.fs.grep", "grep", "Search files for text or regex.", FsGrepArgs, FsGrepResult, false),
];
