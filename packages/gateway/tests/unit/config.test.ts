import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  it("parses defaults for a minimal valid env", () => {
    const config = loadConfig({ GATEWAY_TOKEN: "test-token" });

    expect(config.auth.token).toBe("test-token");
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.server.port).toBe(8788);
    expect(config.database.path).toBe("gateway.db");
  });

  it("throws with a clear error when required fields are missing", () => {
    expect(() => loadConfig({})).toThrow(/GATEWAY_TOKEN/i);
  });

  it("rejects invalid port values", () => {
    expect(() =>
      loadConfig({
        GATEWAY_TOKEN: "test-token",
        GATEWAY_PORT: "99999",
      }),
    ).toThrow(/GATEWAY_PORT/i);
  });

  it("rejects non-numeric port values", () => {
    expect(() =>
      loadConfig({
        GATEWAY_TOKEN: "test-token",
        GATEWAY_PORT: "not-a-number",
      }),
    ).toThrow(/GATEWAY_PORT/i);
  });

  it("coerces boolean env flags", () => {
    expect(
      loadConfig({
        GATEWAY_TOKEN: "test-token",
        TYRUM_ENGINE_API_ENABLED: "1",
      }).execution.engineApiEnabled,
    ).toBe(true);

    expect(
      loadConfig({
        GATEWAY_TOKEN: "test-token",
        TYRUM_ENGINE_API_ENABLED: "0",
      }).execution.engineApiEnabled,
    ).toBe(false);
  });

  it("does not eagerly require kubernetes toolrunner env vars when in-cluster but not configured", () => {
    const edgeConfig = loadConfig({
      GATEWAY_TOKEN: "test-token",
      TYRUM_ROLE: "edge",
      KUBERNETES_SERVICE_HOST: "k8s",
    });
    expect(edgeConfig.execution.toolrunner.launcher).toBe("local");

    const allConfig = loadConfig({
      GATEWAY_TOKEN: "test-token",
      KUBERNETES_SERVICE_HOST: "k8s",
    });
    expect(allConfig.execution.toolrunner.launcher).toBe("local");
  });

  it("requires kubernetes toolrunner env vars when launcher is kubernetes", () => {
    expect(() =>
      loadConfig({
        GATEWAY_TOKEN: "test-token",
        TYRUM_TOOLRUNNER_LAUNCHER: "kubernetes",
      }),
    ).toThrow(/TYRUM_TOOLRUNNER_IMAGE/i);

    expect(() =>
      loadConfig({
        GATEWAY_TOKEN: "test-token",
        TYRUM_TOOLRUNNER_LAUNCHER: "kubernetes",
        TYRUM_TOOLRUNNER_IMAGE: "tyrum/toolrunner:test",
      }),
    ).toThrow(/TYRUM_TOOLRUNNER_WORKSPACE_CLAIM/i);
  });

  it("rejects invalid transport guardrail acknowledgements", () => {
    expect(() =>
      loadConfig({
        GATEWAY_TOKEN: "test-token",
        TYRUM_TLS_READY: "typo",
      }),
    ).toThrow(/TYRUM_TLS_READY/i);

    expect(() =>
      loadConfig({
        GATEWAY_TOKEN: "test-token",
        TYRUM_ALLOW_INSECURE_HTTP: "typo",
      }),
    ).toThrow(/TYRUM_ALLOW_INSECURE_HTTP/i);
  });

  it("parses optional string env vars and strict bool helpers", () => {
    const config = loadConfig({
      GATEWAY_TOKEN: "test-token",
      GATEWAY_TRUSTED_PROXIES: "10.0.0.0/8",
      GATEWAY_MIGRATIONS_DIR: "/tmp/migrations",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel:4318",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://otel:4318/v1/traces",
      TYRUM_ARTIFACT_STORE: "s3",
      TYRUM_ARTIFACTS_DIR: "/tmp/artifacts",
      TYRUM_ARTIFACTS_S3_BUCKET: "my-bucket",
      TYRUM_ARTIFACTS_S3_REGION: "eu-west-1",
      TYRUM_ARTIFACTS_S3_ENDPOINT: "http://minio:9000",
      TYRUM_ARTIFACTS_S3_FORCE_PATH_STYLE: "true",
      TYRUM_ARTIFACTS_S3_ACCESS_KEY_ID: "akid",
      TYRUM_ARTIFACTS_S3_SECRET_ACCESS_KEY: "secret",
      TYRUM_ARTIFACTS_S3_SESSION_TOKEN: "session",
      TYRUM_MODELS_DEV_URL: "http://models-dev",
      TYRUM_POLICY_MODE: "enforce",
      TYRUM_POLICY_BUNDLE_PATH: "/tmp/policy.yaml",
      TYRUM_OAUTH_PROVIDERS_CONFIG: "providers",
      TELEGRAM_BOT_TOKEN: "bot-token",
      TELEGRAM_WEBHOOK_SECRET: "hook-secret",
      TYRUM_CHANNEL_PIPELINE_ENABLED: "0",
      TYRUM_CHANNEL_TYPING_MODE: "thinking",
      KUBERNETES_SERVICE_HOST: "k8s",
      POD_NAMESPACE: "pod-ns",
      TYRUM_TOOLRUNNER_IMAGE: "tyrum/toolrunner:test",
      TYRUM_TOOLRUNNER_WORKSPACE_CLAIM: "workspace-claim",
    });

    expect(config.server.trustedProxies).toBe("10.0.0.0/8");
    expect(config.database.migrationsDir).toBe("/tmp/migrations");
    expect(config.otel.exporterOtlpEndpoint).toBe("http://otel:4318");
    expect(config.otel.exporterOtlpTracesEndpoint).toBe("http://otel:4318/v1/traces");

    expect(config.artifacts.store).toBe("s3");
    expect(config.artifacts.dir).toBe("/tmp/artifacts");
    expect(config.artifacts.s3.bucket).toBe("my-bucket");
    expect(config.artifacts.s3.region).toBe("eu-west-1");
    expect(config.artifacts.s3.endpoint).toBe("http://minio:9000");
    expect(config.artifacts.s3.forcePathStyle).toBe(true);
    expect(config.artifacts.s3.accessKeyId).toBe("akid");
    expect(config.artifacts.s3.secretAccessKey).toBe("secret");
    expect(config.artifacts.s3.sessionToken).toBe("session");

    expect(config.modelsDev.url).toBe("http://models-dev");
    expect(config.policy.mode).toBe("enforce");
    expect(config.policy.bundlePath).toBe("/tmp/policy.yaml");
    expect(config.oauth.providersConfig).toBe("providers");

    expect(config.channels.telegramBotToken).toBe("bot-token");
    expect(config.channels.telegramWebhookSecret).toBe("hook-secret");
    expect(config.channels.pipelineEnabled).toBe(false);
    expect(config.channels.typingMode).toBe("thinking");

    expect(config.execution.toolrunner.launcher).toBe("kubernetes");
    if (config.execution.toolrunner.launcher === "kubernetes") {
      expect(config.execution.toolrunner.namespace).toBe("pod-ns");
      expect(config.execution.toolrunner.workspacePvcClaim).toBe("workspace-claim");
    }
  });

  it("parses typingRefreshMs with invalid and clamp handling", () => {
    expect(
      loadConfig({
        GATEWAY_TOKEN: "test-token",
        TYRUM_CHANNEL_TYPING_REFRESH_MS: "not-a-number",
      }).channels.typingRefreshMs,
    ).toBe(4000);

    expect(
      loadConfig({
        GATEWAY_TOKEN: "test-token",
        TYRUM_CHANNEL_TYPING_REFRESH_MS: "-5",
      }).channels.typingRefreshMs,
    ).toBe(0);

    expect(
      loadConfig({
        GATEWAY_TOKEN: "test-token",
        TYRUM_CHANNEL_TYPING_REFRESH_MS: "500",
      }).channels.typingRefreshMs,
    ).toBe(1000);

    expect(
      loadConfig({
        GATEWAY_TOKEN: "test-token",
        TYRUM_CHANNEL_TYPING_REFRESH_MS: "15000",
      }).channels.typingRefreshMs,
    ).toBe(10000);
  });

  it("parses optional unsigned integer env vars", () => {
    const config = loadConfig({
      GATEWAY_TOKEN: "test-token",
      TYRUM_MODELS_DEV_TIMEOUT_MS: "123",
      TYRUM_MODELS_DEV_REFRESH_INTERVAL_MS: "456",
      TYRUM_CONTEXT_MAX_MESSAGES: "7",
      TYRUM_CONTEXT_TOOL_PRUNE_KEEP_LAST_MESSAGES: "8",
    });

    expect(config.modelsDev.timeoutMs).toBe(123);
    expect(config.modelsDev.refreshIntervalMs).toBe(456);
    expect(config.context.maxMessages).toBe(7);
    expect(config.context.toolPruneKeepLastMessages).toBe(8);

    const invalid = loadConfig({
      GATEWAY_TOKEN: "test-token",
      TYRUM_MODELS_DEV_TIMEOUT_MS: "nope",
      TYRUM_MODELS_DEV_REFRESH_INTERVAL_MS: "1.5",
      TYRUM_CONTEXT_MAX_MESSAGES: "-1",
      TYRUM_CONTEXT_TOOL_PRUNE_KEEP_LAST_MESSAGES: "",
    });

    expect(invalid.modelsDev.timeoutMs).toBeUndefined();
    expect(invalid.modelsDev.refreshIntervalMs).toBeUndefined();
    expect(invalid.context.maxMessages).toBeUndefined();
    expect(invalid.context.toolPruneKeepLastMessages).toBeUndefined();
  });

  it("supports legacy toolrunner workspace claim env var", () => {
    const config = loadConfig({
      GATEWAY_TOKEN: "test-token",
      TYRUM_TOOLRUNNER_LAUNCHER: "kubernetes",
      TYRUM_TOOLRUNNER_IMAGE: "tyrum/toolrunner:test",
      TYRUM_TOOLRUNNER_WORKSPACE_PVC_CLAIM: "workspace-claim",
    });

    expect(config.execution.toolrunner.launcher).toBe("kubernetes");
    if (config.execution.toolrunner.launcher === "kubernetes") {
      expect(config.execution.toolrunner.workspacePvcClaim).toBe("workspace-claim");
    }
  });

  it("infers S3 forcePathStyle from endpoint when unset", () => {
    const config = loadConfig({
      GATEWAY_TOKEN: "test-token",
      TYRUM_ARTIFACT_STORE: "s3",
      TYRUM_ARTIFACTS_S3_ENDPOINT: "http://minio:9000",
    });

    expect(config.artifacts.store).toBe("s3");
    expect(config.artifacts.s3.endpoint).toBe("http://minio:9000");
    expect(config.artifacts.s3.forcePathStyle).toBe(true);
  });

  it("defaults invalid optional values instead of throwing", () => {
    const config = loadConfig({
      GATEWAY_TOKEN: "test-token",
      TYRUM_ROLE: "not-a-role",
      TYRUM_TOOLRUNNER_LAUNCHER: "not-a-launcher",
      TYRUM_ARTIFACT_STORE: "not-a-store",
      TYRUM_CHANNEL_TYPING_MODE: "not-a-mode",
      TYRUM_TOOLRUNNER_HARDENING_PROFILE: "not-a-profile",
    });

    expect(config.runtime.role).toBe("all");
    expect(config.execution.toolrunner.launcher).toBe("local");
    expect(config.artifacts.store).toBe("fs");
    expect(config.channels.typingMode).toBe("never");
    expect(config.toolrunner.hardeningProfile).toBe("baseline");
  });

  it("parses CORS origin allowlist entries", () => {
    const config = loadConfig({
      GATEWAY_TOKEN: "test-token",
      TYRUM_CORS_ORIGINS: "http://localhost:3000, https://example.com, ,",
    });

    expect(config.server.corsOrigins).toEqual(["http://localhost:3000", "https://example.com"]);
  });

  it("parses auth rate limiter defaults", () => {
    const config = loadConfig({ GATEWAY_TOKEN: "test-token" });

    expect(config.auth.rateLimit.windowSeconds).toBe(60);
    expect(config.auth.rateLimit.max).toBe(20);
  });

  it("captures NODE_ENV in runtime config", () => {
    const config = loadConfig({ GATEWAY_TOKEN: "test-token", NODE_ENV: "production" });
    expect(config.runtime.nodeEnv).toBe("production");
  });
});
