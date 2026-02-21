import { z } from "zod";
import { DateTimeSchema } from "./common.js";

export const GatewayRole = z.enum(["all", "edge", "worker", "scheduler"]);
export type GatewayRole = z.infer<typeof GatewayRole>;

export const PolicyMode = z.enum(["enforcing", "disabled"]);
export type PolicyMode = z.infer<typeof PolicyMode>;

export const SandboxMode = z.enum(["default", "hardened"]);
export type SandboxMode = z.infer<typeof SandboxMode>;

export const ToolRunnerLauncher = z.enum(["local", "kubernetes"]);
export type ToolRunnerLauncher = z.infer<typeof ToolRunnerLauncher>;

export const GatewayStatusResponse = z
  .object({
    instance_id: z.string().trim().min(1),
    role: GatewayRole,
    version: z.string().trim().min(1),
    now: DateTimeSchema,
    uptime_ms: z.number().int().nonnegative(),

    model: z
      .object({
        configured: z.boolean(),
        model: z.string().trim().min(1).optional(),
        base_url: z.string().trim().min(1).optional(),
        provider: z.string().trim().min(1).optional(),
        auth_profile: z.string().trim().min(1).optional(),
      })
      .strict(),

    execution: z
      .object({
        queued_jobs: z.number().int().nonnegative(),
        running_jobs: z.number().int().nonnegative(),
        paused_runs: z.number().int().nonnegative(),
        active_run: z
          .object({
            run_id: z.string().trim().min(1),
            job_id: z.string().trim().min(1),
            key: z.string().trim().min(1),
            lane: z.string().trim().min(1),
            status: z.string().trim().min(1),
          })
          .nullable(),
      })
      .strict(),

    policy: z
      .object({
        mode: PolicyMode,
        snapshot_id: z.string().trim().min(1).optional(),
        snapshot_hash: z.string().trim().min(1).optional(),
      })
      .strict(),

    sandbox: z
      .object({
        mode: SandboxMode,
        elevated_execution_available: z.boolean(),
      })
      .strict(),

    toolrunner: z
      .object({
        launcher: ToolRunnerLauncher,
      })
      .strict(),

    context: z
      .object({
        estimated: z
          .object({
            total_bytes: z.number().int().nonnegative(),
            total_est_tokens: z.number().int().nonnegative(),
          })
          .strict(),
        last_report: z
          .object({
            context_report_id: z.string().trim().min(1),
            plan_id: z.string().trim().min(1),
            created_at: DateTimeSchema,
            total_bytes: z.number().int().nonnegative(),
            total_est_tokens: z.number().int().nonnegative(),
          })
          .nullable(),
      })
      .strict(),

    presence: z
      .object({
        count: z.number().int().nonnegative(),
      })
      .strict(),

    connections: z
      .object({
        total_clients: z.number().int().nonnegative(),
        capability_counts: z.record(z.string(), z.number().int().nonnegative()),
      })
      .nullable(),
  })
  .strict();
export type GatewayStatusResponse = z.infer<typeof GatewayStatusResponse>;

export const ContextReportSection = z
  .object({
    name: z.string().trim().min(1),
    bytes: z.number().int().nonnegative(),
    est_tokens: z.number().int().nonnegative(),
  })
  .strict();
export type ContextReportSection = z.infer<typeof ContextReportSection>;

export const ToolSchemaContributor = z
  .object({
    tool_id: z.string().trim().min(1),
    schema_bytes: z.number().int().nonnegative(),
    est_tokens: z.number().int().nonnegative(),
  })
  .strict();
export type ToolSchemaContributor = z.infer<typeof ToolSchemaContributor>;

export const InjectedFileReport = z
  .object({
    path: z.string().trim().min(1),
    raw_bytes: z.number().int().nonnegative(),
    injected_bytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();
export type InjectedFileReport = z.infer<typeof InjectedFileReport>;

export const ContextReportUsage = z
  .object({
    duration_ms: z.number().int().nonnegative().optional(),
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
    model: z.string().trim().min(1).optional(),
    provider: z.string().trim().min(1).optional(),
    auth_profile: z.string().trim().min(1).optional(),
  })
  .strict();
export type ContextReportUsage = z.infer<typeof ContextReportUsage>;

export const ContextReport = z
  .object({
    context_report_id: z.string().trim().min(1),
    plan_id: z.string().trim().min(1),
    session_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional(),
    created_at: DateTimeSchema,

    totals: z
      .object({
        total_bytes: z.number().int().nonnegative(),
        total_est_tokens: z.number().int().nonnegative(),
      })
      .strict(),

    system: z
      .object({
        sections: z.array(ContextReportSection).default([]),
      })
      .strict(),

    messages: z
      .object({
        sections: z.array(ContextReportSection).default([]),
      })
      .strict(),

    tools: z
      .object({
        total_tools: z.number().int().nonnegative(),
        largest_schemas: z.array(ToolSchemaContributor).default([]),
      })
      .strict(),

    files: z
      .object({
        injected_files: z.array(InjectedFileReport).default([]),
      })
      .strict(),

    usage: ContextReportUsage.default({}),
  })
  .strict();
export type ContextReport = z.infer<typeof ContextReport>;

export const UsageResponse = z
  .object({
    scope: z
      .object({
        session_id: z.string().trim().min(1).optional(),
      })
      .strict(),

    agent: z
      .object({
        turns: z.number().int().nonnegative(),
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
        total_tokens: z.number().int().nonnegative(),
        duration_ms: z.number().int().nonnegative(),
      })
      .strict(),

    execution: z
      .object({
        attempts: z.number().int().nonnegative(),
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
        total_tokens: z.number().int().nonnegative(),
        usd_micros: z.number().int().nonnegative(),
        duration_ms: z.number().int().nonnegative(),
      })
      .strict(),

    provider: z
      .object({
        status: z.enum(["disabled", "ok", "error"]),
        cached_at: DateTimeSchema.optional(),
        error: z.string().trim().min(1).optional(),
        data: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();
export type UsageResponse = z.infer<typeof UsageResponse>;

