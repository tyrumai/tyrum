import { describe, expect, it } from "vitest";
import {
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
});
