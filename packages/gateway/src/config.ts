import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { isPostgresDbUri } from "./statestore/db-uri.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseTruthyEnvFlag(value: unknown): boolean {
  const trimmed = normalizeOptionalString(value)?.toLowerCase();
  if (!trimmed) return false;
  return !["0", "false", "off", "no"].includes(trimmed);
}

function parseFalsyEnvFlag(value: unknown): boolean {
  const trimmed = normalizeOptionalString(value)?.toLowerCase();
  if (!trimmed) return false;
  return ["0", "false", "off", "no"].includes(trimmed);
}

function parseStrictTrueEnvFlag(value: unknown): boolean {
  const trimmed = normalizeOptionalString(value);
  if (!trimmed) return false;
  return trimmed === "1" || trimmed.toLowerCase() === "true";
}

function parseOptionalUint(value: unknown): number | undefined {
  const raw = normalizeOptionalString(value);
  if (!raw) return undefined;
  if (!/^[0-9]+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return undefined;
  return parsed;
}

function parseStrictTransportGuardrailFlag(
  value: unknown,
  envVar: string,
  ctx: z.RefinementCtx,
): boolean {
  const trimmed = normalizeOptionalString(value);
  if (!trimmed) return false;
  const normalized = trimmed.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `${envVar} must be one of 1|true|yes|on|0|false|no|off (got '${trimmed}')`,
  });
  return z.NEVER;
}

function resolveDefaultMigrationsDir(dbPath: string): string {
  return isPostgresDbUri(dbPath)
    ? join(__dirname, "../migrations/postgres")
    : join(__dirname, "../migrations/sqlite");
}

function parsePort(raw: unknown, ctx: z.RefinementCtx): number {
  const value = normalizeOptionalString(raw) ?? "8788";
  if (!/^[0-9]+$/.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `GATEWAY_PORT must be an integer between 1 and 65535 (got '${value}')`,
    });
    return z.NEVER;
  }
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed > 0 && parsed <= 65535;
  if (!valid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `GATEWAY_PORT must be an integer between 1 and 65535 (got '${value}')`,
    });
    return z.NEVER;
  }
  return parsed;
}

function parseGatewayRole(raw: unknown): "all" | "edge" | "worker" | "scheduler" {
  const value = normalizeOptionalString(raw)?.toLowerCase();
  if (value === "all" || value === "edge" || value === "worker" || value === "scheduler")
    return value;
  return "all";
}

function parseToolRunnerLauncher(
  raw: unknown,
  isKubernetesRuntime: boolean,
): "local" | "kubernetes" {
  const value = normalizeOptionalString(raw)?.toLowerCase();
  if (!value) return isKubernetesRuntime ? "kubernetes" : "local";
  if (value === "kubernetes") return "kubernetes";
  return "local";
}

type ToolRunnerConfig =
  | { launcher: "local" }
  | { launcher: "kubernetes"; namespace: string; image: string; workspacePvcClaim: string };

function requireWhen<T>(
  condition: true,
  value: T | undefined,
  envVar: string,
  ctx: z.RefinementCtx,
): T;
function requireWhen<T>(
  condition: false,
  value: T | undefined,
  envVar: string,
  ctx: z.RefinementCtx,
): T | undefined;
function requireWhen<T>(
  condition: boolean,
  value: T | undefined,
  envVar: string,
  ctx: z.RefinementCtx,
): T | undefined {
  if (!condition) return value;
  if (value !== undefined) return value;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `${envVar} is required when TYRUM_TOOLRUNNER_LAUNCHER=kubernetes`,
  });
  return z.NEVER;
}

export const GatewayConfigSchema = z
  .object({
    server: z.object({
      /** `GATEWAY_HOST` (default: `127.0.0.1`). */
      host: z.unknown().transform((value) => normalizeOptionalString(value) ?? "127.0.0.1"),

      /** `GATEWAY_PORT` (default: `8788`). Must be an integer between 1 and 65535. */
      port: z.unknown().transform((value, ctx) => parsePort(value, ctx)),

      /** `GATEWAY_TRUSTED_PROXIES` (default: unset). Comma-separated proxy allowlist. */
      trustedProxies: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),

      /** `TYRUM_TLS_READY` (default: `false`). Set to acknowledge TLS termination is configured. */
      tlsReady: z
        .unknown()
        .transform((value, ctx) =>
          parseStrictTransportGuardrailFlag(value, "TYRUM_TLS_READY", ctx),
        ),

      /**
       * `TYRUM_ALLOW_INSECURE_HTTP` (default: `false`).
       * Allows plaintext HTTP on non-loopback interfaces in trusted networks.
       */
      allowInsecureHttp: z
        .unknown()
        .transform((value, ctx) =>
          parseStrictTransportGuardrailFlag(value, "TYRUM_ALLOW_INSECURE_HTTP", ctx),
        ),
    }),

    auth: z.object({
      /**
       * `GATEWAY_TOKEN` (required).
       * Used for HTTP + WebSocket authentication.
       */
      token: z.unknown().transform((value, ctx) => {
        const token = normalizeOptionalString(value);
        if (token) return token;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "GATEWAY_TOKEN is required",
        });
        return z.NEVER;
      }),
    }),

    database: z.object({
      /** `GATEWAY_DB_PATH` (default: `gateway.db`). SQLite path or `postgres://...` URI. */
      path: z.unknown().transform((value) => normalizeOptionalString(value) ?? "gateway.db"),

      /**
       * `GATEWAY_MIGRATIONS_DIR` (default: derived).
       * Defaults to the SQLite or Postgres migrations directory based on `GATEWAY_DB_PATH`.
       */
      migrationsDir: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),
    }),

    runtime: z.object({
      /** `TYRUM_INSTANCE_ID` (default: unset). A stable identifier for logs and clustering. */
      instanceId: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),

      /** `TYRUM_ROLE` (default: `all`). */
      role: z.unknown().transform((value) => parseGatewayRole(value)),
    }),

    paths: z.object({
      /**
       * `TYRUM_HOME` (default: `~/.tyrum`).
       * The gateway workspace directory for tokens, caches, and runtime state.
       */
      home: z
        .unknown()
        .transform((value) => normalizeOptionalString(value) ?? join(homedir(), ".tyrum")),

      /**
       * `TYRUM_HOME` (default: `false`).
       * True when `TYRUM_HOME` is explicitly set (non-empty) in the environment.
       */
      homeExplicit: z.unknown().transform((value) => normalizeOptionalString(value) !== undefined),

      /**
       * `TYRUM_USER_HOME` (default: `~/.tyrum`).
       * User-scoped home (separate from the workspace home for split/HA deployments).
       */
      userHome: z
        .unknown()
        .transform((value) => normalizeOptionalString(value) ?? join(homedir(), ".tyrum")),
    }),

    otel: z.object({
      /**
       * `TYRUM_OTEL_ENABLED` (default: `false`).
       * When enabled, the gateway starts OpenTelemetry tracing.
       */
      enabled: z.unknown().transform((value) => typeof value === "string" && value === "1"),

      /** `OTEL_EXPORTER_OTLP_ENDPOINT` (default: unset). Base OTLP HTTP endpoint. */
      exporterOtlpEndpoint: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),

      /** `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (default: unset). Full OTLP traces endpoint. */
      exporterOtlpTracesEndpoint: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),
    }),

    artifacts: z.object({
      /** `TYRUM_ARTIFACT_STORE` (default: `fs`). One of `fs` or `s3`. */
      store: z
        .unknown()
        .transform((value) =>
          normalizeOptionalString(value)?.toLowerCase() === "s3" ? "s3" : "fs",
        ),

      /** `TYRUM_ARTIFACTS_DIR` (default: `${TYRUM_HOME}/artifacts`). */
      dir: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),

      s3: z.object({
        /** `TYRUM_ARTIFACTS_S3_BUCKET` (default: `tyrum-artifacts`). */
        bucket: z
          .unknown()
          .transform((value) => normalizeOptionalString(value))
          .optional(),

        /** `TYRUM_ARTIFACTS_S3_REGION` (default: `us-east-1`). */
        region: z
          .unknown()
          .transform((value) => normalizeOptionalString(value))
          .optional(),

        /** `TYRUM_ARTIFACTS_S3_ENDPOINT` (default: unset). */
        endpoint: z
          .unknown()
          .transform((value) => normalizeOptionalString(value))
          .optional(),

        /** `TYRUM_ARTIFACTS_S3_FORCE_PATH_STYLE` (default: unset). */
        forcePathStyle: z
          .unknown()
          .transform((value) => parseStrictTrueEnvFlag(value))
          .optional(),

        /** `TYRUM_ARTIFACTS_S3_ACCESS_KEY_ID` (default: unset). */
        accessKeyId: z
          .unknown()
          .transform((value) => normalizeOptionalString(value))
          .optional(),

        /** `TYRUM_ARTIFACTS_S3_SECRET_ACCESS_KEY` (default: unset). */
        secretAccessKey: z
          .unknown()
          .transform((value) => normalizeOptionalString(value))
          .optional(),

        /** `TYRUM_ARTIFACTS_S3_SESSION_TOKEN` (default: unset). */
        sessionToken: z
          .unknown()
          .transform((value) => normalizeOptionalString(value))
          .optional(),
      }),
    }),

    execution: z.object({
      /** `TYRUM_ENGINE_API_ENABLED` (default: `false`). Enables the execution engine HTTP API. */
      engineApiEnabled: z.unknown().transform((value) => parseTruthyEnvFlag(value)),

      toolrunner: z
        .object({
          /** `TYRUM_TOOLRUNNER_LAUNCHER` (default: `local`, or `kubernetes` when in-cluster). */
          launcher: z.unknown(),

          /** `KUBERNETES_SERVICE_HOST` (default: unset). Indicates we are running in Kubernetes. */
          kubernetesServiceHost: z
            .unknown()
            .transform((value) => normalizeOptionalString(value))
            .optional(),

          /** `TYRUM_TOOLRUNNER_NAMESPACE` (default: unset). */
          namespace: z.unknown(),

          /** `POD_NAMESPACE` (default: unset). */
          podNamespace: z
            .unknown()
            .transform((value) => normalizeOptionalString(value))
            .optional(),

          /** `TYRUM_TOOLRUNNER_IMAGE` (required when launcher is kubernetes). */
          image: z.unknown(),

          /** `TYRUM_TOOLRUNNER_WORKSPACE_CLAIM` (required when launcher is kubernetes). */
          workspaceClaim: z.unknown(),
        })
        .transform((value, ctx): ToolRunnerConfig => {
          const isKubernetesRuntime = Boolean(value.kubernetesServiceHost);
          const launcher = parseToolRunnerLauncher(value.launcher, isKubernetesRuntime);

          if (launcher === "kubernetes") {
            const namespace =
              normalizeOptionalString(value.namespace) ?? value.podNamespace ?? "default";
            const image = normalizeOptionalString(value.image);
            const workspacePvcClaim = normalizeOptionalString(value.workspaceClaim);
            return {
              launcher: "kubernetes",
              namespace,
              image: requireWhen(true, image, "TYRUM_TOOLRUNNER_IMAGE", ctx),
              workspacePvcClaim: requireWhen(
                true,
                workspacePvcClaim,
                "TYRUM_TOOLRUNNER_WORKSPACE_CLAIM",
                ctx,
              ),
            };
          }

          return { launcher: "local" };
        }),
    }),

    channels: z.object({
      /** `TELEGRAM_BOT_TOKEN` (default: unset). */
      telegramBotToken: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),

      /** `TELEGRAM_WEBHOOK_SECRET` (default: unset). */
      telegramWebhookSecret: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),

      /** `TYRUM_CHANNEL_PIPELINE_ENABLED` (default: `true`). */
      pipelineEnabled: z.unknown().transform((value) => !parseFalsyEnvFlag(value)),

      /** `TYRUM_CHANNEL_TYPING_AUTOMATION_ENABLED` (default: `false`). */
      typingAutomationEnabled: z.unknown().transform((value) => parseTruthyEnvFlag(value)),

      /** `TYRUM_CHANNEL_TYPING_MODE` (default: `never`). */
      typingMode: z.unknown().transform((value) => {
        const mode = normalizeOptionalString(value)?.toLowerCase();
        if (mode === "never" || mode === "message" || mode === "thinking" || mode === "instant") {
          return mode;
        }
        return "never";
      }),

      /** `TYRUM_CHANNEL_TYPING_REFRESH_MS` (default: `4000`). */
      typingRefreshMs: z.unknown().transform((value) => {
        const raw = normalizeOptionalString(value);
        if (!raw) return 4000;
        if (!/^-?[0-9]+$/.test(raw)) return 4000;
        const parsed = Number(raw);
        if (!Number.isSafeInteger(parsed)) return 4000;
        if (parsed <= 0) return 0;
        return Math.min(10_000, Math.max(1000, parsed));
      }),
    }),

    modelsDev: z.object({
      /** `TYRUM_MODELS_DEV_URL` (default: unset). */
      url: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),

      /** `TYRUM_MODELS_DEV_TIMEOUT_MS` (default: unset). */
      timeoutMs: z
        .unknown()
        .transform((value) => parseOptionalUint(value))
        .optional(),

      /** `TYRUM_MODELS_DEV_REFRESH_INTERVAL_MS` (default: unset). */
      refreshIntervalMs: z
        .unknown()
        .transform((value) => parseOptionalUint(value))
        .optional(),

      /** `TYRUM_MODELS_DEV_DISABLE_FETCH` (default: `false`). */
      disableFetch: z.unknown().transform((value) => parseTruthyEnvFlag(value)),
    }),

    policy: z.object({
      /** `TYRUM_POLICY_ENABLED` (default: `true`). */
      enabled: z.unknown().transform((value) => !parseFalsyEnvFlag(value)),

      /** `TYRUM_POLICY_MODE` (default: unset). */
      mode: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),

      /** `TYRUM_POLICY_BUNDLE_PATH` (default: unset). */
      bundlePath: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),
    }),

    oauth: z.object({
      /** `TYRUM_OAUTH_PROVIDERS_CONFIG` (default: unset). */
      providersConfig: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),
    }),

    agent: z.object({
      /** `TYRUM_AGENT_ENABLED` (default: `true`). */
      enabled: z.unknown().transform((value) => !parseFalsyEnvFlag(value)),

      /** `TYRUM_AGENT_ID` (default: `default`). */
      id: z.unknown().transform((value) => normalizeOptionalString(value) ?? "default"),
    }),

    automation: z.object({
      /** `TYRUM_AUTOMATION_ENABLED` (default: `false`). */
      enabled: z.unknown().transform((value) => parseTruthyEnvFlag(value)),
    }),

    snapshots: z.object({
      /** `TYRUM_SNAPSHOT_IMPORT_ENABLED` (default: `false`). */
      importEnabled: z.unknown().transform((value) => parseTruthyEnvFlag(value)),
    }),

    context: z.object({
      /** `TYRUM_CONTEXT_MAX_MESSAGES` (default: unset). */
      maxMessages: z
        .unknown()
        .transform((value) => parseOptionalUint(value))
        .optional(),

      /** `TYRUM_CONTEXT_TOOL_PRUNE_KEEP_LAST_MESSAGES` (default: unset). */
      toolPruneKeepLastMessages: z
        .unknown()
        .transform((value) => parseOptionalUint(value))
        .optional(),
    }),

    logging: z.object({
      /** `TYRUM_LOG_LEVEL` (default: unset). One of debug|info|warn|error|silent. */
      level: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),

      /** `LOG_LEVEL` (default: unset). Alias of `TYRUM_LOG_LEVEL`. */
      legacyLevel: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),
    }),

    secrets: z.object({
      /** `TYRUM_SECRET_PROVIDER` (default: unset). */
      provider: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),
    }),

    toolrunner: z.object({
      /** `TYRUM_TOOLRUNNER_PAYLOAD` (default: unset). JSON payload for toolrunner stdio mode. */
      payload: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),

      /** `TYRUM_TOOLRUNNER_HARDENING_PROFILE` (default: baseline). */
      hardeningProfile: z
        .unknown()
        .transform((value) =>
          normalizeOptionalString(value)?.toLowerCase() === "hardened" ? "hardened" : "baseline",
        ),
    }),

    workspace: z.object({
      /** `TYRUM_WORKSPACE_ID` (default: unset). */
      id: z
        .unknown()
        .transform((value) => normalizeOptionalString(value))
        .optional(),

      /** `TYRUM_AUTH_PROFILES_ENABLED` (default: unset). */
      authProfilesEnabled: z.unknown().transform((value) => parseTruthyEnvFlag(value)),
    }),
  })
  .transform((value) => {
    const migrationsDir =
      value.database.migrationsDir ?? resolveDefaultMigrationsDir(value.database.path);
    const artifactsDir = value.artifacts.dir ?? join(value.paths.home, "artifacts");
    const forcePathStyle =
      value.artifacts.s3.forcePathStyle !== undefined
        ? value.artifacts.s3.forcePathStyle
        : value.artifacts.s3.endpoint !== undefined;

    const otelEnabled =
      value.otel.enabled ||
      Boolean(value.otel.exporterOtlpEndpoint) ||
      Boolean(value.otel.exporterOtlpTracesEndpoint);

    return {
      ...value,
      database: {
        ...value.database,
        migrationsDir,
      },
      artifacts: {
        ...value.artifacts,
        dir: artifactsDir,
        s3: {
          ...value.artifacts.s3,
          bucket: value.artifacts.s3.bucket ?? "tyrum-artifacts",
          region: value.artifacts.s3.region ?? "us-east-1",
          forcePathStyle,
        },
      },
      otel: {
        ...value.otel,
        enabled: otelEnabled,
      },
    };
  });

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv): GatewayConfig {
  const input = {
    server: {
      host: env["GATEWAY_HOST"],
      port: env["GATEWAY_PORT"],
      trustedProxies: env["GATEWAY_TRUSTED_PROXIES"],
      tlsReady: env["TYRUM_TLS_READY"],
      allowInsecureHttp: env["TYRUM_ALLOW_INSECURE_HTTP"],
    },
    auth: {
      token: env["GATEWAY_TOKEN"],
    },
    database: {
      path: env["GATEWAY_DB_PATH"],
      migrationsDir: env["GATEWAY_MIGRATIONS_DIR"],
    },
    runtime: {
      instanceId: env["TYRUM_INSTANCE_ID"],
      role: env["TYRUM_ROLE"],
    },
    paths: {
      home: env["TYRUM_HOME"],
      homeExplicit: env["TYRUM_HOME"],
      userHome: env["TYRUM_USER_HOME"],
    },
    otel: {
      enabled: env["TYRUM_OTEL_ENABLED"],
      exporterOtlpEndpoint: env["OTEL_EXPORTER_OTLP_ENDPOINT"],
      exporterOtlpTracesEndpoint: env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"],
    },
    artifacts: {
      store: env["TYRUM_ARTIFACT_STORE"],
      dir: env["TYRUM_ARTIFACTS_DIR"],
      s3: {
        bucket: env["TYRUM_ARTIFACTS_S3_BUCKET"],
        region: env["TYRUM_ARTIFACTS_S3_REGION"],
        endpoint: env["TYRUM_ARTIFACTS_S3_ENDPOINT"],
        forcePathStyle: env["TYRUM_ARTIFACTS_S3_FORCE_PATH_STYLE"],
        accessKeyId: env["TYRUM_ARTIFACTS_S3_ACCESS_KEY_ID"],
        secretAccessKey: env["TYRUM_ARTIFACTS_S3_SECRET_ACCESS_KEY"],
        sessionToken: env["TYRUM_ARTIFACTS_S3_SESSION_TOKEN"],
      },
    },
    execution: {
      engineApiEnabled: env["TYRUM_ENGINE_API_ENABLED"],
      toolrunner: {
        launcher: env["TYRUM_TOOLRUNNER_LAUNCHER"],
        kubernetesServiceHost: env["KUBERNETES_SERVICE_HOST"],
        namespace: env["TYRUM_TOOLRUNNER_NAMESPACE"],
        podNamespace: env["POD_NAMESPACE"],
        image: env["TYRUM_TOOLRUNNER_IMAGE"],
        workspaceClaim:
          env["TYRUM_TOOLRUNNER_WORKSPACE_CLAIM"] ?? env["TYRUM_TOOLRUNNER_WORKSPACE_PVC_CLAIM"],
      },
    },
    channels: {
      telegramBotToken: env["TELEGRAM_BOT_TOKEN"],
      telegramWebhookSecret: env["TELEGRAM_WEBHOOK_SECRET"],
      pipelineEnabled: env["TYRUM_CHANNEL_PIPELINE_ENABLED"],
      typingAutomationEnabled: env["TYRUM_CHANNEL_TYPING_AUTOMATION_ENABLED"],
      typingMode: env["TYRUM_CHANNEL_TYPING_MODE"],
      typingRefreshMs: env["TYRUM_CHANNEL_TYPING_REFRESH_MS"],
    },
    modelsDev: {
      url: env["TYRUM_MODELS_DEV_URL"],
      timeoutMs: env["TYRUM_MODELS_DEV_TIMEOUT_MS"],
      refreshIntervalMs: env["TYRUM_MODELS_DEV_REFRESH_INTERVAL_MS"],
      disableFetch: env["TYRUM_MODELS_DEV_DISABLE_FETCH"],
    },
    policy: {
      enabled: env["TYRUM_POLICY_ENABLED"],
      mode: env["TYRUM_POLICY_MODE"],
      bundlePath: env["TYRUM_POLICY_BUNDLE_PATH"],
    },
    oauth: {
      providersConfig: env["TYRUM_OAUTH_PROVIDERS_CONFIG"],
    },
    agent: {
      enabled: env["TYRUM_AGENT_ENABLED"],
      id: env["TYRUM_AGENT_ID"],
    },
    automation: {
      enabled: env["TYRUM_AUTOMATION_ENABLED"],
    },
    snapshots: {
      importEnabled: env["TYRUM_SNAPSHOT_IMPORT_ENABLED"],
    },
    context: {
      maxMessages: env["TYRUM_CONTEXT_MAX_MESSAGES"],
      toolPruneKeepLastMessages: env["TYRUM_CONTEXT_TOOL_PRUNE_KEEP_LAST_MESSAGES"],
    },
    logging: {
      level: env["TYRUM_LOG_LEVEL"],
      legacyLevel: env["LOG_LEVEL"],
    },
    secrets: {
      provider: env["TYRUM_SECRET_PROVIDER"],
    },
    toolrunner: {
      payload: env["TYRUM_TOOLRUNNER_PAYLOAD"],
      hardeningProfile: env["TYRUM_TOOLRUNNER_HARDENING_PROFILE"],
    },
    workspace: {
      id: env["TYRUM_WORKSPACE_ID"],
      authProfilesEnabled: env["TYRUM_AUTH_PROFILES_ENABLED"],
    },
  };

  const parsed = GatewayConfigSchema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  const missingEnvVars = parsed.error.issues
    .filter((issue) => /required/i.test(issue.message))
    .map((issue) => issue.message);
  if (missingEnvVars.length > 0) {
    throw new Error(`Invalid gateway config: ${missingEnvVars.join("; ")}`);
  }
  const message = parsed.error.issues.map((issue) => issue.message).join("; ");
  throw new Error(`Invalid gateway config: ${message}`);
}
