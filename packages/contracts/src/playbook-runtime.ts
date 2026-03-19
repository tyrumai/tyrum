import { z } from "zod";

export const PlaybookRuntimeRunRequest = z
  .object({
    action: z.literal("run"),
    pipeline: z.string().trim().min(1),
    argsJson: z.string().optional(),
    cwd: z.string().trim().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
    maxOutputBytes: z.number().int().positive().optional(),
  })
  .strict();
export type PlaybookRuntimeRunRequest = z.infer<typeof PlaybookRuntimeRunRequest>;

export const PlaybookRuntimeResumeRequest = z
  .object({
    action: z.literal("resume"),
    token: z.string().trim().min(1),
    approve: z.boolean(),
    reason: z.string().trim().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();
export type PlaybookRuntimeResumeRequest = z.infer<typeof PlaybookRuntimeResumeRequest>;

export const PlaybookRuntimeRequest = z.discriminatedUnion("action", [
  PlaybookRuntimeRunRequest,
  PlaybookRuntimeResumeRequest,
]);
export type PlaybookRuntimeRequest = z.infer<typeof PlaybookRuntimeRequest>;

export const PlaybookRuntimeRequiresApproval = z
  .object({
    prompt: z.string(),
    items: z.array(z.unknown()).default([]),
    resumeToken: z.string().trim().min(1),
  })
  .strict();
export type PlaybookRuntimeRequiresApproval = z.infer<typeof PlaybookRuntimeRequiresApproval>;

export const PlaybookRuntimeError = z
  .object({
    message: z.string(),
    code: z.string().trim().min(1).optional(),
  })
  .strict();
export type PlaybookRuntimeError = z.infer<typeof PlaybookRuntimeError>;

export const PlaybookRuntimeEnvelope = z.discriminatedUnion("status", [
  z
    .object({
      ok: z.literal(true),
      status: z.literal("ok"),
      output: z.array(z.unknown()),
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      status: z.literal("needs_approval"),
      output: z.array(z.unknown()),
      requiresApproval: PlaybookRuntimeRequiresApproval,
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      status: z.literal("cancelled"),
      output: z.array(z.unknown()),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      status: z.literal("error"),
      output: z.array(z.unknown()),
      error: PlaybookRuntimeError,
    })
    .strict(),
]);
export type PlaybookRuntimeEnvelope = z.infer<typeof PlaybookRuntimeEnvelope>;
