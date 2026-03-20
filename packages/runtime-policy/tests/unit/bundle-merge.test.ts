import { describe, expect, it } from "vitest";
import { PolicyBundle } from "@tyrum/contracts";
import { mergePolicyBundles } from "@tyrum/runtime-policy";

describe("mergePolicyBundles", () => {
  it("unions tool patterns and keeps the most restrictive domain defaults", () => {
    const merged = mergePolicyBundles([
      PolicyBundle.parse({
        v: 1,
        tools: {
          allow: ["bash"],
          require_approval: ["webfetch"],
          deny: [],
        },
        network_egress: {
          default: "allow",
          allow: ["https://example.com/*"],
          require_approval: [],
          deny: [],
        },
      }),
      PolicyBundle.parse({
        v: 1,
        tools: {
          allow: ["bash"],
          require_approval: [],
          deny: ["rm"],
        },
        network_egress: {
          default: "deny",
          allow: [],
          require_approval: ["https://review.example.com/*"],
          deny: [],
        },
      }),
    ]);

    expect(merged.tools).toEqual({
      allow: ["bash"],
      require_approval: ["webfetch"],
      deny: ["rm"],
    });
    expect(merged.network_egress.default).toBe("deny");
    expect(merged.network_egress.allow).toContain("https://example.com/*");
    expect(merged.network_egress.require_approval).toContain("https://review.example.com/*");
  });

  it("chooses minimum positive artifact retention and quota values", () => {
    const merged = mergePolicyBundles([
      PolicyBundle.parse({
        v: 1,
        artifacts: {
          default: "allow",
          retention: {
            default_days: 30,
            by_sensitivity: { normal: 20, sensitive: 10 },
            by_label: { logs: 14 },
            by_label_sensitivity: { docs: { normal: 9, sensitive: 5 } },
          },
          quota: {
            default_max_bytes: 2_000,
            by_sensitivity: { normal: 1_500, sensitive: 1_000 },
            by_label: { logs: 900 },
            by_label_sensitivity: { docs: { normal: 700, sensitive: 500 } },
          },
        },
      }),
      PolicyBundle.parse({
        v: 1,
        artifacts: {
          default: "require_approval",
          retention: {
            default_days: 10,
            by_sensitivity: { normal: 15, sensitive: 6 },
            by_label: { logs: 7 },
            by_label_sensitivity: { docs: { normal: 4, sensitive: 3 } },
          },
          quota: {
            default_max_bytes: 1_000,
            by_sensitivity: { normal: 1_200, sensitive: 800 },
            by_label: { logs: 600 },
            by_label_sensitivity: { docs: { normal: 300, sensitive: 250 } },
          },
        },
      }),
    ]);

    expect(merged.artifacts.default).toBe("require_approval");
    expect(merged.artifacts.retention).toEqual({
      default_days: 10,
      by_sensitivity: { normal: 15, sensitive: 6 },
      by_label: { logs: 7 },
      by_label_sensitivity: { docs: { normal: 4, sensitive: 3 } },
    });
    expect(merged.artifacts.quota).toEqual({
      default_max_bytes: 1_000,
      by_sensitivity: { normal: 1_200, sensitive: 800 },
      by_label: { logs: 600 },
      by_label_sensitivity: { docs: { normal: 300, sensitive: 250 } },
    });
  });

  it("ignores non-positive and non-finite artifact values", () => {
    const invalidBundle = {
      v: 1,
      artifacts: {
        retention: {
          default_days: 0,
          by_label: { logs: -1 },
        },
        quota: {
          default_max_bytes: Number.NaN,
          by_label: { logs: Number.POSITIVE_INFINITY },
        },
      },
    } as unknown as ReturnType<typeof PolicyBundle.parse>;

    const merged = mergePolicyBundles([invalidBundle]);

    expect(merged.artifacts.retention).toBeUndefined();
    expect(merged.artifacts.quota).toBeUndefined();
  });

  it("merges provenance booleans conservatively", () => {
    expect(
      mergePolicyBundles([
        PolicyBundle.parse({ v: 1 }),
        PolicyBundle.parse({ v: 1, provenance: { untrusted_shell_requires_approval: false } }),
      ]).provenance.untrusted_shell_requires_approval,
    ).toBe(false);

    expect(
      mergePolicyBundles([
        PolicyBundle.parse({ v: 1, provenance: { untrusted_shell_requires_approval: false } }),
        PolicyBundle.parse({ v: 1, provenance: { untrusted_shell_requires_approval: true } }),
      ]).provenance.untrusted_shell_requires_approval,
    ).toBe(true);
  });
});
