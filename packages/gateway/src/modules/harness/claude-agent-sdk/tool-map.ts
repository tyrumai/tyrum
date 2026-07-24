import { harnessArg, type HarnessToolMap } from "../tool-mapping.js";

/**
 * Claude Agent SDK built-in tools projected onto Tyrum's taxonomy.
 *
 * This table states what a call *is*, never whether it is permitted. Anything
 * absent here — `Task`, `TodoWrite`, every MCP tool — resolves as unmapped and
 * therefore `state_changing`, so it reaches the ask channel.
 *
 * A gap here is not neutral: policy rules are matched against the *Tyrum* tool
 * id, so a harness built-in with a Tyrum equivalent that is missing from this
 * table would be evaluated under its harness name (`WebSearch`) and a
 * `deny: ["websearch"]` rule would never fire. `harness-tool-mapping.test.ts`
 * holds that line by requiring every Tyrum built-in tool id to be either mapped
 * here or explicitly recorded as having no Claude equivalent.
 */
export const CLAUDE_AGENT_SDK_TOOL_MAP: HarnessToolMap = {
  Bash: {
    toolId: "bash",
    effect: "state_changing",
    toPolicyArgs: harnessArg.passthrough("command"),
  },
  Read: {
    toolId: "read",
    effect: "read_only",
    toPolicyArgs: harnessArg.path("file_path"),
    pathArg: "file_path",
  },
  Write: {
    toolId: "write",
    effect: "state_changing",
    toPolicyArgs: harnessArg.path("file_path"),
    pathArg: "file_path",
  },
  Edit: {
    toolId: "edit",
    effect: "state_changing",
    toPolicyArgs: harnessArg.path("file_path"),
    pathArg: "file_path",
  },
  // The SDK's file-permission checks treat NotebookEdit as an Edit; mirror that
  // so a notebook write cannot dodge an `edit:` policy rule.
  NotebookEdit: {
    toolId: "edit",
    effect: "state_changing",
    toPolicyArgs: harnessArg.path("notebook_path"),
    pathArg: "notebook_path",
  },
  Glob: {
    toolId: "glob",
    effect: "read_only",
    toPolicyArgs: harnessArg.passthrough("pattern"),
    // Optional in the SDK and defaulted to the session cwd, but the model may
    // name any directory, so it is confined like every other path argument.
    pathArg: "path",
  },
  Grep: {
    toolId: "grep",
    effect: "read_only",
    toPolicyArgs: harnessArg.passthrough("pattern"),
    pathArg: "path",
  },
  WebSearch: {
    toolId: "websearch",
    effect: "read_only",
    toPolicyArgs: harnessArg.passthrough("query"),
  },
  WebFetch: {
    toolId: "webfetch",
    effect: "read_only",
    toPolicyArgs: harnessArg.passthrough("url"),
    urlOf: harnessArg.urlFrom("url"),
  },
};

/**
 * Tyrum built-in tool ids with no Claude Agent SDK equivalent.
 *
 * Recorded rather than inferred so that adding a Tyrum tool the SDK also ships
 * fails the mapping-coverage test instead of silently evaluating the harness
 * call under its harness name.
 */
export const CLAUDE_TOOL_IDS_WITHOUT_SDK_EQUIVALENT: readonly string[] = [
  // Tyrum's patch applier; the SDK edits through Edit/Write instead.
  "apply_patch",
  // Tyrum-hosted repository search; the SDK has no counterpart tool.
  "codesearch",
];
