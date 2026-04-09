import { describe, expect, it } from "vitest";
import { DeploymentConfig } from "@tyrum/contracts";
import { assertSharedStateModeGuardrails } from "../../src/modules/runtime-state/validation.js";

const PUBLIC_BASE_URL = "https://gateway.example.test";

describe("shared state mode guardrails", () => {
  it("accepts shared mode with postgres, s3 artifacts, and external tls", () => {
    expect(() =>
      assertSharedStateModeGuardrails({
        dbPath: "postgres://user:pass@localhost:5432/tyrum",
        deploymentConfig: DeploymentConfig.parse({
          state: { mode: "shared" },
          artifacts: { store: "s3" },
          server: { publicBaseUrl: PUBLIC_BASE_URL, tlsReady: true },
        }),
      }),
    ).not.toThrow();
  });

  it("rejects local-only shared mode settings", () => {
    expect(() =>
      assertSharedStateModeGuardrails({
        dbPath: "/tmp/gateway.db",
        deploymentConfig: DeploymentConfig.parse({
          state: { mode: "shared" },
          artifacts: { store: "fs" },
          server: { publicBaseUrl: PUBLIC_BASE_URL, allowInsecureHttp: true },
          policy: { bundlePath: "/tmp/policy.json" },
        }),
      }),
    ).toThrow(/invalid shared deployment configuration/);
  });
});
