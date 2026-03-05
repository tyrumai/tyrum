import { z } from "zod";
import { DateTimeSchema } from "./common.js";

export const DeploymentConfigServer = z
  .object({
    trustedProxies: z.string().trim().min(1).optional(),
    corsOrigins: z.array(z.string().trim().min(1)).default([]),
    tlsReady: z.boolean().default(false),
    tlsSelfSigned: z.boolean().default(false),
    allowInsecureHttp: z.boolean().default(false),
  })
  .strict();
export type DeploymentConfigServer = z.infer<typeof DeploymentConfigServer>;

export const DeploymentConfigAuthRateLimit = z
  .object({
    windowSeconds: z.number().int().positive().default(60),
    max: z.number().int().positive().default(20),
  })
  .strict();
export type DeploymentConfigAuthRateLimit = z.infer<typeof DeploymentConfigAuthRateLimit>;

export const DeploymentConfigAuth = z
  .object({
    rateLimit: DeploymentConfigAuthRateLimit.prefault({}),
  })
  .strict();
export type DeploymentConfigAuth = z.infer<typeof DeploymentConfigAuth>;

export const DeploymentConfigOtel = z
  .object({
    enabled: z.boolean().default(false),
    exporterOtlpEndpoint: z.string().trim().min(1).optional(),
    exporterOtlpTracesEndpoint: z.string().trim().min(1).optional(),
  })
  .strict();
export type DeploymentConfigOtel = z.infer<typeof DeploymentConfigOtel>;

export const DeploymentConfigArtifactsS3 = z
  .object({
    bucket: z.string().trim().min(1).optional(),
    region: z.string().trim().min(1).optional(),
    endpoint: z.string().trim().min(1).optional(),
    forcePathStyle: z.boolean().optional(),
    accessKeyId: z.string().trim().min(1).optional(),
    secretAccessKey: z.string().trim().min(1).optional(),
    sessionToken: z.string().trim().min(1).optional(),
  })
  .strict();
export type DeploymentConfigArtifactsS3 = z.infer<typeof DeploymentConfigArtifactsS3>;

export const DeploymentConfigArtifacts = z
  .object({
    store: z.enum(["fs", "s3"]).default("fs"),
    dir: z.string().trim().min(1).optional(),
    s3: DeploymentConfigArtifactsS3.prefault({}),
  })
  .strict();
export type DeploymentConfigArtifacts = z.infer<typeof DeploymentConfigArtifacts>;

export const DeploymentConfigToolRunner = z
  .object({
    hardeningProfile: z.enum(["baseline", "hardened"]).default("baseline"),
  })
  .strict();
export type DeploymentConfigToolRunner = z.infer<typeof DeploymentConfigToolRunner>;

export const DeploymentConfigExecutionToolRunner = z
  .discriminatedUnion("launcher", [
    z
      .object({
        launcher: z.literal("local"),
      })
      .strict(),
    z
      .object({
        launcher: z.literal("kubernetes"),
        namespace: z.string().trim().min(1).default("default"),
        image: z.string().trim().min(1),
        workspacePvcClaim: z.string().trim().min(1),
      })
      .strict(),
  ])
  .default({ launcher: "local" });
export type DeploymentConfigExecutionToolRunner = z.infer<
  typeof DeploymentConfigExecutionToolRunner
>;

export const DeploymentConfigExecution = z
  .object({
    engineApiEnabled: z.boolean().default(false),
    toolrunner: DeploymentConfigExecutionToolRunner,
  })
  .strict();
export type DeploymentConfigExecution = z.infer<typeof DeploymentConfigExecution>;

export const DeploymentConfigChannels = z
  .object({
    telegramBotToken: z.string().trim().min(1).optional(),
    telegramWebhookSecret: z.string().trim().min(1).optional(),
    pipelineEnabled: z.boolean().default(true),
    typingAutomationEnabled: z.boolean().default(false),
    typingMode: z.enum(["never", "message", "thinking", "instant"]).default("never"),
    typingRefreshMs: z.number().int().min(0).max(10_000).default(4000),
  })
  .strict();
export type DeploymentConfigChannels = z.infer<typeof DeploymentConfigChannels>;

export const DeploymentConfigWebsocket = z
  .object({
    maxBufferedBytes: z.number().int().positive().optional(),
  })
  .strict();
export type DeploymentConfigWebsocket = z.infer<typeof DeploymentConfigWebsocket>;

export const DeploymentConfigModelsDev = z
  .object({
    url: z.string().trim().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
    refreshIntervalMs: z.number().int().positive().optional(),
    disableFetch: z.boolean().default(false),
  })
  .strict();
export type DeploymentConfigModelsDev = z.infer<typeof DeploymentConfigModelsDev>;

export const DeploymentConfigPolicy = z
  .object({
    enabled: z.boolean().default(true),
    mode: z.string().trim().min(1).optional(),
    bundlePath: z.string().trim().min(1).optional(),
  })
  .strict();
export type DeploymentConfigPolicy = z.infer<typeof DeploymentConfigPolicy>;

export const DeploymentConfigAgent = z
  .object({
    enabled: z.boolean().default(true),
  })
  .strict();
export type DeploymentConfigAgent = z.infer<typeof DeploymentConfigAgent>;

export const DeploymentConfigAutomation = z
  .object({
    enabled: z.boolean().default(false),
  })
  .strict();
export type DeploymentConfigAutomation = z.infer<typeof DeploymentConfigAutomation>;

export const DeploymentConfigSnapshots = z
  .object({
    importEnabled: z.boolean().default(false),
  })
  .strict();
export type DeploymentConfigSnapshots = z.infer<typeof DeploymentConfigSnapshots>;

export const DeploymentConfigContext = z
  .object({
    maxMessages: z.number().int().positive().optional(),
    toolPruneKeepLastMessages: z.number().int().positive().optional(),
  })
  .strict();
export type DeploymentConfigContext = z.infer<typeof DeploymentConfigContext>;

export const DeploymentConfigLifecycleSessions = z
  .object({
    ttlDays: z.number().int().positive().default(30),
  })
  .strict();
export type DeploymentConfigLifecycleSessions = z.infer<typeof DeploymentConfigLifecycleSessions>;

export const DeploymentConfigLifecycleChannels = z
  .object({
    terminalRetentionDays: z.number().int().positive().default(7),
  })
  .strict();
export type DeploymentConfigLifecycleChannels = z.infer<typeof DeploymentConfigLifecycleChannels>;

export const DeploymentConfigLifecycle = z
  .object({
    sessions: DeploymentConfigLifecycleSessions.prefault({}),
    channels: DeploymentConfigLifecycleChannels.prefault({}),
  })
  .strict();
export type DeploymentConfigLifecycle = z.infer<typeof DeploymentConfigLifecycle>;

export const DeploymentConfigLogging = z
  .object({
    level: z.enum(["debug", "info", "warn", "error", "silent"]).optional(),
  })
  .strict();
export type DeploymentConfigLogging = z.infer<typeof DeploymentConfigLogging>;

export const DeploymentConfig = z
  .object({
    v: z.number().int().min(1).default(1),
    server: DeploymentConfigServer.prefault({}),
    auth: DeploymentConfigAuth.prefault({}),
    otel: DeploymentConfigOtel.prefault({}),
    artifacts: DeploymentConfigArtifacts.prefault({}),
    execution: DeploymentConfigExecution.prefault({}),
    channels: DeploymentConfigChannels.prefault({}),
    websocket: DeploymentConfigWebsocket.prefault({}),
    modelsDev: DeploymentConfigModelsDev.prefault({}),
    policy: DeploymentConfigPolicy.prefault({}),
    agent: DeploymentConfigAgent.prefault({}),
    automation: DeploymentConfigAutomation.prefault({}),
    snapshots: DeploymentConfigSnapshots.prefault({}),
    context: DeploymentConfigContext.prefault({}),
    lifecycle: DeploymentConfigLifecycle.prefault({}),
    logging: DeploymentConfigLogging.prefault({}),
    toolrunner: DeploymentConfigToolRunner.prefault({}),
  })
  .strict();
export type DeploymentConfig = z.infer<typeof DeploymentConfig>;

export const DeploymentConfigRevisionNumber = z.number().int().positive();
export type DeploymentConfigRevisionNumber = z.infer<typeof DeploymentConfigRevisionNumber>;

export const DeploymentConfigGetResponse = z
  .object({
    revision: z.number().int().nonnegative(),
    config: DeploymentConfig,
    created_at: DateTimeSchema.optional(),
    created_by: z.unknown().optional(),
    reason: z.string().trim().min(1).optional(),
    reverted_from_revision: DeploymentConfigRevisionNumber.optional(),
  })
  .strict();
export type DeploymentConfigGetResponse = z.infer<typeof DeploymentConfigGetResponse>;

export const DeploymentConfigUpdateRequest = z
  .object({
    config: DeploymentConfig,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type DeploymentConfigUpdateRequest = z.infer<typeof DeploymentConfigUpdateRequest>;

export const DeploymentConfigUpdateResponse = DeploymentConfigGetResponse;
export type DeploymentConfigUpdateResponse = z.infer<typeof DeploymentConfigUpdateResponse>;

export const DeploymentConfigRevertRequest = z
  .object({
    revision: DeploymentConfigRevisionNumber,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type DeploymentConfigRevertRequest = z.infer<typeof DeploymentConfigRevertRequest>;

export const DeploymentConfigRevertResponse = DeploymentConfigGetResponse;
export type DeploymentConfigRevertResponse = z.infer<typeof DeploymentConfigRevertResponse>;
