import { describe, expect, it } from "vitest";
import {
  normalizeToolRows,
  policyBundleToFormState,
  policyFormStateToBundle,
} from "../../src/components/pages/admin-http-policy-shared.js";

describe("admin-http-policy-shared", () => {
  it("uses schema-aligned deny defaults for missing policy domains", () => {
    const formState = policyBundleToFormState({ v: 1 });

    expect(formState.tools.defaultDecision).toBe("deny");
    expect(formState.networkEgress.defaultDecision).toBe("deny");
    expect(formState.secrets.defaultDecision).toBe("deny");
    expect(formState.connectors.defaultDecision).toBe("deny");
  });

  it("round-trips missing policy domains back to deny defaults", () => {
    const bundle = policyFormStateToBundle(policyBundleToFormState({ v: 1 }));

    expect(bundle.tools?.default).toBe("deny");
    expect(bundle.network_egress?.default).toBe("deny");
    expect(bundle.secrets?.default).toBe("deny");
    expect(bundle.connectors?.default).toBe("deny");
  });

  it("expands tool group aliases before save to match schema canonicalization", () => {
    const allowRows = normalizeToolRows([{ id: "allow-1", value: "tool.fs.*" }]);
    const bundle = policyFormStateToBundle({
      tools: {
        defaultDecision: "deny",
        allow: allowRows,
        requireApproval: [],
        deny: [],
      },
      networkEgress: {
        defaultDecision: "deny",
        allow: [],
        requireApproval: [],
        deny: [],
      },
      secrets: {
        defaultDecision: "deny",
        allow: [],
        requireApproval: [],
        deny: [],
      },
      connectors: {
        defaultDecision: "deny",
        allow: [],
        requireApproval: [],
        deny: [],
      },
      artifacts: {
        defaultDecision: "allow",
        retentionDefaultDays: "",
        retentionByLabel: [],
        retentionBySensitivity: { normal: "", sensitive: "" },
        retentionByLabelSensitivity: [],
        quotaDefaultMaxBytes: "",
        quotaByLabel: [],
        quotaBySensitivity: { normal: "", sensitive: "" },
        quotaByLabelSensitivity: [],
      },
      provenance: {
        untrustedShellRequiresApproval: true,
      },
    });

    expect(allowRows.map((row) => row.value)).toEqual([
      "read",
      "write",
      "edit",
      "apply_patch",
      "glob",
      "grep",
    ]);
    expect(bundle.tools?.allow).toEqual(["read", "write", "edit", "apply_patch", "glob", "grep"]);
  });
});
