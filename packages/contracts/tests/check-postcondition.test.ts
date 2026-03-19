import { describe, expect, it } from "vitest";
import { checkPostcondition } from "../src/postcondition.js";
import type { EvaluationContext } from "../src/postcondition.js";

describe("checkPostcondition", () => {
  it("returns passed when spec is undefined", () => {
    const result = checkPostcondition(undefined, {});
    expect(result).toEqual({ passed: true });
  });

  it("returns passed when spec is null", () => {
    const result = checkPostcondition(null, {});
    expect(result).toEqual({ passed: true });
  });

  it("returns passed when assertions pass", () => {
    const spec = {
      assertions: [{ type: "http_status", equals: 200 }],
    };
    const ctx: EvaluationContext = { http: { status: 200 } };

    const result = checkPostcondition(spec, ctx);
    expect(result.passed).toBe(true);
    expect(result.report).toBeDefined();
    expect(result.report!.passed).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns failed with error message when assertions fail", () => {
    const spec = { type: "http_status", equals: 200 };
    const ctx: EvaluationContext = { http: { status: 500 } };

    const result = checkPostcondition(spec, ctx);
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/^postcondition failed:/);
    expect(result.error).toContain("http_status");
    expect(result.report).toBeDefined();
    expect(result.report!.passed).toBe(false);
  });

  it("returns failed with postcondition error for PostconditionError", () => {
    // Missing http context triggers PostconditionError (missing_evidence)
    const spec = { type: "http_status", equals: 200 };
    const ctx: EvaluationContext = {};

    const result = checkPostcondition(spec, ctx);
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/^postcondition error:/);
    expect(result.report).toBeUndefined();
  });

  it("returns failed with postcondition error for invalid spec", () => {
    const spec = { assertions: "not-an-array" };
    const result = checkPostcondition(spec, {});
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/^postcondition error:/);
  });

  it("re-throws unknown errors", () => {
    // Create a spec that will cause evaluatePostcondition to throw a non-PostconditionError.
    // We can do this by passing a spec with a getter that throws.
    const badSpec = {
      get assertions(): never {
        throw new TypeError("boom");
      },
    };

    expect(() => checkPostcondition(badSpec, {})).toThrow(TypeError);
    expect(() => checkPostcondition(badSpec, {})).toThrow("boom");
  });

  it("includes report in failed result", () => {
    const spec = {
      assertions: [
        { type: "http_status", equals: 200 },
        { type: "http_status", equals: 201 },
      ],
    };
    const ctx: EvaluationContext = { http: { status: 200 } };

    const result = checkPostcondition(spec, ctx);
    expect(result.passed).toBe(false);
    expect(result.report).toBeDefined();
    expect(result.report!.assertions).toHaveLength(2);
  });

  it("formats multiple failures in error string", () => {
    const spec = {
      assertions: [
        { type: "http_status", equals: 201 },
        { type: "json_path", path: "$.ok", equals: true },
      ],
    };
    const ctx: EvaluationContext = {
      http: { status: 500 },
      json: { ok: false },
    };

    const result = checkPostcondition(spec, ctx);
    expect(result.passed).toBe(false);
    expect(result.error).toContain("http_status:");
    expect(result.error).toContain("json_path_equals:");
  });
});
