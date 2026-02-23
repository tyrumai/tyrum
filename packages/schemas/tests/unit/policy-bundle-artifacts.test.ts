import { describe, expect, it } from "vitest";
import { PolicyBundle } from "@tyrum/schemas";

describe("PolicyBundle.artifacts retention/quota", () => {
  it("accepts retention and quota policies by label and sensitivity class", () => {
    const bundle = PolicyBundle.parse({
      v: 1,
      artifacts: {
        default: "allow",
        retention: {
          default_days: 30,
          by_label: {
            log: 14,
            screenshot: 7,
          },
          by_sensitivity: {
            normal: 30,
            sensitive: 3,
          },
          by_label_sensitivity: {
            log: { sensitive: 1 },
          },
        },
        quota: {
          default_max_bytes: 1_000_000,
          by_label: {
            log: 100_000,
          },
          by_sensitivity: {
            sensitive: 10_000,
          },
          by_label_sensitivity: {
            screenshot: { sensitive: 5_000 },
          },
        },
      },
    });

    expect(bundle.artifacts?.retention?.default_days).toBe(30);
    expect(bundle.artifacts?.retention?.by_label?.log).toBe(14);
    expect(bundle.artifacts?.retention?.by_sensitivity?.sensitive).toBe(3);
    expect(bundle.artifacts?.retention?.by_label_sensitivity?.log?.sensitive).toBe(1);

    expect(bundle.artifacts?.quota?.default_max_bytes).toBe(1_000_000);
    expect(bundle.artifacts?.quota?.by_label?.log).toBe(100_000);
    expect(bundle.artifacts?.quota?.by_sensitivity?.sensitive).toBe(10_000);
    expect(bundle.artifacts?.quota?.by_label_sensitivity?.screenshot?.sensitive).toBe(5_000);
  });

  it("rejects invalid retention/quota values", () => {
    expect(() =>
      PolicyBundle.parse({
        v: 1,
        artifacts: {
          default: "allow",
          retention: {
            default_days: 0,
          },
        },
      }),
    ).toThrow();

    expect(() =>
      PolicyBundle.parse({
        v: 1,
        artifacts: {
          default: "allow",
          quota: {
            default_max_bytes: -1,
          },
        },
      }),
    ).toThrow();
  });
});

