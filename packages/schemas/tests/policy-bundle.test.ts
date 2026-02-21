import { describe, expect, it } from "vitest";
import { PolicyBundle, PolicyEffect } from "../src/index.js";

describe("PolicyBundle contracts", () => {
  it("parses minimal v1 bundle with defaults", () => {
    const bundle = PolicyBundle.parse({ version: 1 });

    expect(bundle.version).toBe(1);
    expect(bundle.tools.default).toBe("allow");
    expect(bundle.actions.default).toBe("allow");
    expect(bundle.network.egress.default).toBe("require_approval");
    expect(bundle.secrets.resolve.default).toBe("require_approval");
    expect(bundle.provenance.rules).toEqual([]);
  });

  it("rejects unknown keys (strict)", () => {
    expect(() =>
      PolicyBundle.parse({ version: 1, extra: 123 } as unknown),
    ).toThrow();
  });

  it("exports stable enums", () => {
    expect(PolicyEffect.options).toContain("allow");
    expect(PolicyEffect.options).toContain("deny");
    expect(PolicyEffect.options).toContain("require_approval");
  });
});
