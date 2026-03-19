import { z } from "zod";

// ---------------------------------------------------------------------------
// Filesystem action schemas — file and shell operations
// ---------------------------------------------------------------------------
// Each action gets an Args and Result schema. All use `.strict()`.
// The `op` field identifies the operation in the discriminated union.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1. Read
// ---------------------------------------------------------------------------

export const FsReadArgs = z
  .object({
    op: z.literal("read"),
    path: z.string(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
export type FsReadArgs = z.infer<typeof FsReadArgs>;

export const FsReadResult = z
  .object({
    content: z.string(),
    path: z.string(),
    raw_chars: z.number().int().nonnegative(),
    selected_chars: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();
export type FsReadResult = z.infer<typeof FsReadResult>;

// ---------------------------------------------------------------------------
// 2. Write
// ---------------------------------------------------------------------------

export const FsWriteArgs = z
  .object({
    op: z.literal("write"),
    path: z.string(),
    content: z.string(),
  })
  .strict();
export type FsWriteArgs = z.infer<typeof FsWriteArgs>;

export const FsWriteResult = z
  .object({
    path: z.string(),
    bytes_written: z.number().int().nonnegative(),
  })
  .strict();
export type FsWriteResult = z.infer<typeof FsWriteResult>;

// ---------------------------------------------------------------------------
// 3. Edit
// ---------------------------------------------------------------------------

export const FsEditArgs = z
  .object({
    op: z.literal("edit"),
    path: z.string(),
    old_string: z.string(),
    new_string: z.string(),
    replace_all: z.boolean().optional(),
  })
  .strict();
export type FsEditArgs = z.infer<typeof FsEditArgs>;

export const FsEditResult = z
  .object({
    path: z.string(),
    replacements: z.number().int().nonnegative(),
  })
  .strict();
export type FsEditResult = z.infer<typeof FsEditResult>;

// ---------------------------------------------------------------------------
// 4. Apply patch
// ---------------------------------------------------------------------------

export const FsApplyPatchArgs = z
  .object({
    op: z.literal("apply_patch"),
    patch: z.string(),
  })
  .strict();
export type FsApplyPatchArgs = z.infer<typeof FsApplyPatchArgs>;

export const FsApplyPatchResult = z
  .object({
    applied: z.array(z.string()),
  })
  .strict();
export type FsApplyPatchResult = z.infer<typeof FsApplyPatchResult>;

// ---------------------------------------------------------------------------
// 5. Bash
// ---------------------------------------------------------------------------

export const FsBashArgs = z
  .object({
    op: z.literal("bash"),
    command: z.string(),
    cwd: z.string().optional(),
    timeout_ms: z.number().int().positive().optional(),
  })
  .strict();
export type FsBashArgs = z.infer<typeof FsBashArgs>;

export const FsBashResult = z
  .object({
    output: z.string(),
    exit_code: z.number().int().nullable(),
  })
  .strict();
export type FsBashResult = z.infer<typeof FsBashResult>;

// ---------------------------------------------------------------------------
// 6. Glob
// ---------------------------------------------------------------------------

export const FsGlobArgs = z
  .object({
    op: z.literal("glob"),
    pattern: z.string(),
    path: z.string().optional(),
  })
  .strict();
export type FsGlobArgs = z.infer<typeof FsGlobArgs>;

export const FsGlobResult = z
  .object({
    matches: z.array(z.string()),
  })
  .strict();
export type FsGlobResult = z.infer<typeof FsGlobResult>;

// ---------------------------------------------------------------------------
// 7. Grep
// ---------------------------------------------------------------------------

export const FsGrepArgs = z
  .object({
    op: z.literal("grep"),
    pattern: z.string(),
    path: z.string().optional(),
    include: z.string().optional(),
    regex: z.boolean().optional(),
    ignore_case: z.boolean().optional(),
  })
  .strict();
export type FsGrepArgs = z.infer<typeof FsGrepArgs>;

export const FsGrepResult = z
  .object({
    matches: z.array(z.string()),
  })
  .strict();
export type FsGrepResult = z.infer<typeof FsGrepResult>;

// ---------------------------------------------------------------------------
// Discriminated union of all filesystem action argument types
// ---------------------------------------------------------------------------

export const FilesystemActionArgs = z.discriminatedUnion("op", [
  FsReadArgs,
  FsWriteArgs,
  FsEditArgs,
  FsApplyPatchArgs,
  FsBashArgs,
  FsGlobArgs,
  FsGrepArgs,
]);
export type FilesystemActionArgs = z.infer<typeof FilesystemActionArgs>;
