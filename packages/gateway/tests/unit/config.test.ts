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
});
