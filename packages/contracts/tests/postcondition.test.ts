import { describe, expect, it } from "vitest";
import { evaluatePostcondition, PostconditionError } from "../src/postcondition.js";
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
      expect((report.assertions[0]!.detail as Record<string, number>)["status"]).toBe(200);
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
    expect((meta["metadata"] as Record<string, unknown>)["strategy"]).toBe("generic-http");
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

  it("json_path_equals with matching nested object", () => {
    const spec = {
      type: "json_path",
      path: "$.data",
      equals: { key: "value", nested: { a: 1 } },
    };
    const ctx: EvaluationContext = {
      json: { data: { key: "value", nested: { a: 1 } } },
    };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(true);
  });

  it("json_path_equals with mismatching nested object", () => {
    const spec = {
      type: "json_path",
      path: "$.data",
      equals: { key: "value" },
    };
    const ctx: EvaluationContext = {
      json: { data: { key: "other" } },
    };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(false);
    const a = report.assertions[0]!;
    expect(a.status).toBe("failed");
    if (a.status === "failed") {
      expect(a.code).toBe("json_path_predicate_failed");
    }
  });

  it("json_path_equals with matching array", () => {
    const spec = {
      type: "json_path",
      path: "$.items",
      equals: [1, 2, 3],
    };
    const ctx: EvaluationContext = { json: { items: [1, 2, 3] } };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(true);
  });

  it("json_path_equals fails for arrays of different length", () => {
    const spec = {
      type: "json_path",
      path: "$.items",
      equals: [1, 2],
    };
    const ctx: EvaluationContext = { json: { items: [1, 2, 3] } };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(false);
  });

  it("json_path_equals fails for type mismatch (number vs string)", () => {
    const spec = {
      type: "json_path",
      path: "$.count",
      equals: "42",
    };
    const ctx: EvaluationContext = { json: { count: 42 } };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(false);
  });

  it("json_path_equals fails when one is null and other is not", () => {
    const spec = {
      type: "json_path",
      path: "$.val",
      equals: null,
    };
    const ctx: EvaluationContext = { json: { val: "something" } };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(false);
  });

  it("json_path_equals fails for array vs object comparison", () => {
    const spec = {
      type: "json_path",
      path: "$.data",
      equals: [1, 2],
    };
    const ctx: EvaluationContext = { json: { data: { a: 1 } } };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(false);
  });

  it("json_path_equals fails for objects with different key counts", () => {
    const spec = {
      type: "json_path",
      path: "$.data",
      equals: { a: 1 },
    };
    const ctx: EvaluationContext = { json: { data: { a: 1, b: 2 } } };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(false);
  });

  it("json_path_equals passes for matching boolean value", () => {
    const spec = {
      type: "json_path",
      path: "$.enabled",
      equals: true,
    };
    const ctx: EvaluationContext = { json: { enabled: true } };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(true);
  });

  it("json_path_equals fails for different primitive types (number vs number)", () => {
    const spec = {
      type: "json_path",
      path: "$.n",
      equals: 1,
    };
    const ctx: EvaluationContext = { json: { n: 2 } };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(false);
  });

  it("json_path with array index access", () => {
    const spec = {
      type: "json_path",
      path: "$.items[1]",
      equals: "second",
    };
    const ctx: EvaluationContext = { json: { items: ["first", "second", "third"] } };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(true);
  });

  it("dom_contains fails when text not found", () => {
    const spec = {
      type: "dom_contains",
      text: "missing",
    };
    const ctx: EvaluationContext = {
      dom: { html: "<p>Hello world</p>" },
    };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(false);
    const a = report.assertions[0]!;
    expect(a.status).toBe("failed");
    if (a.status === "failed") {
      expect(a.code).toBe("dom_text_missing");
    }
  });

  it("throws when http context missing for http_status", () => {
    const spec = { type: "http_status", equals: 200 };
    expect(() => evaluatePostcondition(spec, {})).toThrow(PostconditionError);
  });

  it("throws when dom context missing for dom_contains", () => {
    const spec = { type: "dom_contains", text: "hello" };
    expect(() => evaluatePostcondition(spec, {})).toThrow(PostconditionError);
  });

  it("throws when json context missing for json_path", () => {
    const spec = { type: "json_path", path: "$.x", equals: 1 };
    expect(() => evaluatePostcondition(spec, {})).toThrow(PostconditionError);
  });

  it("throws on empty assertions array", () => {
    expect(() => evaluatePostcondition([], {})).toThrow(PostconditionError);
  });

  it("throws on non-object assertion in array", () => {
    expect(() => evaluatePostcondition([42], {})).toThrow(PostconditionError);
  });

  it("throws on assertion missing type field", () => {
    expect(() => evaluatePostcondition([{ equals: 200 }], {})).toThrow(PostconditionError);
  });

  it("throws on object without assertions or type", () => {
    expect(() => evaluatePostcondition({ foo: "bar" }, {})).toThrow(PostconditionError);
  });

  it("throws on non-object/non-array postcondition", () => {
    expect(() => evaluatePostcondition(42, {})).toThrow(PostconditionError);
  });

  it("throws on assertions field that is not an array", () => {
    expect(() => evaluatePostcondition({ assertions: "not-an-array" }, {})).toThrow(
      PostconditionError,
    );
  });

  it("json_path throws on invalid path syntax", () => {
    const spec = { type: "json_path", path: "", equals: 1 };
    expect(() => evaluatePostcondition(spec, { json: {} })).toThrow(PostconditionError);
  });

  it("json_path throws on path not starting with $", () => {
    const spec = { type: "json_path", path: "foo", equals: 1 };
    expect(() => evaluatePostcondition(spec, { json: {} })).toThrow(PostconditionError);
  });

  it("json_path throws on path ending with dot", () => {
    const spec = { type: "json_path", path: "$.", equals: 1 };
    expect(() => evaluatePostcondition(spec, { json: {} })).toThrow(PostconditionError);
  });

  it("json_path throws on missing closing bracket", () => {
    const spec = { type: "json_path", path: "$.items[0", equals: 1 };
    expect(() => evaluatePostcondition(spec, { json: {} })).toThrow(PostconditionError);
  });

  it("json_path throws on empty array index", () => {
    const spec = { type: "json_path", path: "$.items[]", equals: 1 };
    expect(() => evaluatePostcondition(spec, { json: {} })).toThrow(PostconditionError);
  });

  it("json_path throws on negative array index", () => {
    const spec = { type: "json_path", path: "$.items[-1]", equals: 1 };
    expect(() => evaluatePostcondition(spec, { json: {} })).toThrow(PostconditionError);
  });

  it("json_path throws on empty field name after dot", () => {
    const spec = { type: "json_path", path: "$..items", equals: 1 };
    expect(() => evaluatePostcondition(spec, { json: {} })).toThrow(PostconditionError);
  });

  it("json_path throws on unexpected characters after $", () => {
    const spec = { type: "json_path", path: "$foo", equals: 1 };
    expect(() => evaluatePostcondition(spec, { json: {} })).toThrow(PostconditionError);
  });

  it("http_status throws on non-integer equals", () => {
    const spec = { type: "http_status", equals: "200" };
    expect(() => evaluatePostcondition(spec, { http: { status: 200 } })).toThrow(
      PostconditionError,
    );
  });

  it("http_status throws on out-of-range equals", () => {
    const spec = { type: "http_status", equals: 70000 };
    expect(() => evaluatePostcondition(spec, { http: { status: 200 } })).toThrow(
      PostconditionError,
    );
  });

  it("dom_contains throws on non-string text", () => {
    const spec = { type: "dom_contains", text: 42 };
    expect(() => evaluatePostcondition(spec, { dom: { html: "hello" } })).toThrow(
      PostconditionError,
    );
  });

  it("json_path throws on missing equals", () => {
    const spec = { type: "json_path", path: "$.x" };
    expect(() => evaluatePostcondition(spec, { json: {} })).toThrow(PostconditionError);
  });

  it("json_path throws on missing path field", () => {
    const spec = { type: "json_path", equals: 1 };
    expect(() => evaluatePostcondition(spec, { json: {} })).toThrow(PostconditionError);
  });

  it("resolveJsonPath returns undefined when traversing non-object", () => {
    const spec = {
      type: "json_path",
      path: "$.a.b",
      equals: 1,
    };
    const ctx: EvaluationContext = { json: { a: 42 } };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(false);
    const a = report.assertions[0]!;
    if (a.status === "failed") {
      expect(a.code).toBe("json_path_missing");
    }
  });

  it("resolveJsonPath returns undefined for array index on non-array", () => {
    const spec = {
      type: "json_path",
      path: "$.data[0]",
      equals: 1,
    };
    const ctx: EvaluationContext = { json: { data: { key: "val" } } };

    const report = evaluatePostcondition(spec, ctx);
    expect(report.passed).toBe(false);
    const a = report.assertions[0]!;
    if (a.status === "failed") {
      expect(a.code).toBe("json_path_missing");
    }
  });
});
