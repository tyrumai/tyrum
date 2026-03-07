import { describe, expect, it } from "vitest";
import { DeploymentConfig } from "@tyrum/schemas";
import { assertSharedStateModeGuardrails } from "../../src/modules/runtime-state/validation.js";

describe("shared state mode guardrails", () => {
  it("accepts shared mode with postgres, s3 artifacts, and external tls", () => {
    expect(() =>
      assertSharedStateModeGuardrails({
        dbPath: "postgres://user:pass@localhost:5432/tyrum",
        deploymentConfig: DeploymentConfig.parse({
          state: { mode: "shared" },
          artifacts: { store: "s3" },
          server: { tlsReady: true },
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
          server: { tlsSelfSigned: true },
          policy: { bundlePath: "/tmp/policy.json" },
        }),
      }),
    ).toThrow(/invalid shared deployment configuration/);
  });
});
