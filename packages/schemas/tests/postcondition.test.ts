import { describe, expect, it } from "vitest";
import {
  evaluatePostcondition,
  PostconditionError,
} from "../src/postcondition.js";
import type { EvaluationContext } from "../src/postcondition.js";

describe("evaluatePostcondition", () => {
  it("http_status passes when expected", () => {
    const spec = {
      assertions: [{ type: "http_status", equals: 200 }],
    };
    const ctx: EvaluationContext = { http: { status: 200 } };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(true);
    expect(report.assertions).toHaveLength(1);
    expect(report.assertions[0]!.status).toBe("passed");
    if (report.assertions[0]!.status === "passed") {
      expect((report.assertions[0]!.detail as Record<string, number>)["status"]).toBe(
        200,
      );
    }
  });

  it("http_status failure includes expected and observed", () => {
    const spec = { type: "http_status", equals: 201 };
    const ctx: EvaluationContext = { http: { status: 500 } };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(false);
    const assertion = report.assertions[0]!;
    expect(assertion.status).toBe("failed");
    if (assertion.status === "failed") {
      expect(assertion.code).toBe("http_status_mismatch");
      expect((assertion.expected as Record<string, number>)["status"]).toBe(201);
      expect((assertion.observed as Record<string, number>)["status"]).toBe(500);
    }
  });

  it("dom_contains respects case_insensitive flag", () => {
    const spec = {
      type: "dom_contains",
      text: "Success",
      case_insensitive: true,
    };
    const ctx: EvaluationContext = {
      dom: {
        selector: "#status",
        html: '<div id="status">success!</div>',
      },
    };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(true);
  });

  it("json_path_equals verifies value", () => {
    const spec = {
      assertions: [{ type: "json_path", path: "$.status", equals: "ok" }],
    };
    const payload = { status: "ok" };
    const ctx: EvaluationContext = { json: payload };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(true);
  });

  it("json_path missing reports failure", () => {
    const spec = {
      type: "json_path",
      path: "$.missing",
      equals: true,
    };
    const ctx: EvaluationContext = { json: { status: true } };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(false);
    const assertion = report.assertions[0]!;
    expect(assertion.status).toBe("failed");
    if (assertion.status === "failed") {
      expect(assertion.code).toBe("json_path_missing");
    }
  });

  it("metadata preserved in report", () => {
    const spec = {
      assertions: [{ type: "http_status", equals: 200 }],
      metadata: {
        status: "completed",
        strategy: "generic-http",
        details: { rank: 1 },
      },
    };
    const ctx: EvaluationContext = { http: { status: 200 } };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(true);
    expect(report.metadata).toBeDefined();
    const meta = report.metadata as Record<string, unknown>;
    expect((meta["metadata"] as Record<string, unknown>)["status"]).toBe("completed");
    expect((meta["metadata"] as Record<string, unknown>)["strategy"]).toBe(
      "generic-http",
    );
  });

  it("unsupported type returns error", () => {
    const spec = { type: "sql", query: "select 1" };
    expect(() => evaluatePostcondition(spec, {})).toThrow(PostconditionError);
    try {
      evaluatePostcondition(spec, {});
    } catch (e) {
      expect(e).toBeInstanceOf(PostconditionError);
      expect((e as PostconditionError).kind).toBe("unsupported_postcondition");
    }
  });
});
