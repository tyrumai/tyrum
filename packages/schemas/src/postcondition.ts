import { z } from "zod";

export const AssertionKind = z.enum([
  "http_status",
  "dom_contains",
  "json_path_equals",
]);
export type AssertionKind = z.infer<typeof AssertionKind>;

export const AssertionFailureCode = z.enum([
  "http_status_mismatch",
  "dom_text_missing",
  "json_path_missing",
  "json_path_predicate_failed",
]);
export type AssertionFailureCode = z.infer<typeof AssertionFailureCode>;

export const AssertionOutcome = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("passed"),
    detail: z.unknown().optional(),
  }),
  z.object({
    status: z.literal("failed"),
    code: AssertionFailureCode,
    message: z.string(),
    expected: z.unknown().optional(),
    observed: z.unknown().optional(),
  }),
]);
export type AssertionOutcome = z.infer<typeof AssertionOutcome>;

export const AssertionResult = z.object({
  kind: AssertionKind,
}).and(AssertionOutcome);
export type AssertionResult = z.infer<typeof AssertionResult>;

export const PostconditionReport = z.object({
  passed: z.boolean(),
  assertions: z.array(AssertionResult).default([]),
  metadata: z.unknown().optional(),
});
export type PostconditionReport = z.infer<typeof PostconditionReport>;

// --- Evaluation engine (pure function port from postconditions.rs) ---

const REDACTED = "[REDACTED]";

export interface HttpContext {
  status: number;
}

export interface DomContext {
  selector?: string;
  html: string;
}

export interface EvaluationContext {
  http?: HttpContext;
  json?: unknown;
  dom?: DomContext;
}

export class PostconditionError extends Error {
  constructor(
    public readonly kind:
      | "invalid_postcondition"
      | "unsupported_postcondition"
      | "missing_evidence",
    message: string,
  ) {
    super(message);
    this.name = "PostconditionError";
  }
}

type AssertionSpec =
  | { type: "http_status"; expected: number }
  | {
      type: "dom_contains";
      text: string;
      selector?: string;
      case_insensitive: boolean;
    }
  | { type: "json_path_equals"; path: string; expected: unknown };

interface ParsedSpec {
  assertions: AssertionSpec[];
  metadata: unknown;
}

export function evaluatePostcondition(
  raw: unknown,
  context: EvaluationContext,
): PostconditionReport {
  const parsed = parseSpec(raw);
  const results: AssertionResult[] = [];
  let overallPassed = true;

  for (const assertion of parsed.assertions) {
    const result = evaluateAssertion(assertion, context);
    if (result.status !== "passed") {
      overallPassed = false;
    }
    results.push(result);
  }

  return { passed: overallPassed, assertions: results, metadata: parsed.metadata };
}

function parseSpec(raw: unknown): ParsedSpec {
  if (Array.isArray(raw)) {
    return { assertions: parseAssertionArray(raw), metadata: undefined };
  }
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if ("assertions" in obj) {
      const arr = obj["assertions"];
      if (!Array.isArray(arr)) {
        throw new PostconditionError(
          "invalid_postcondition",
          "`assertions` must be an array",
        );
      }
      const assertions = parseAssertionArray(arr);
      const metadata: Record<string, unknown> = {};
      let hasMetadata = false;
      for (const [key, value] of Object.entries(obj)) {
        if (key !== "assertions") {
          metadata[key] = value;
          hasMetadata = true;
        }
      }
      return { assertions, metadata: hasMetadata ? metadata : undefined };
    }
    if ("type" in obj) {
      return { assertions: [parseAssertion(raw)], metadata: undefined };
    }
    const keys = Object.keys(obj).sort().join(",");
    throw new PostconditionError(
      "unsupported_postcondition",
      `object_with_fields:${keys}`,
    );
  }
  throw new PostconditionError(
    "invalid_postcondition",
    "postcondition must be an object or array",
  );
}

function parseAssertionArray(items: unknown[]): AssertionSpec[] {
  if (items.length === 0) {
    throw new PostconditionError(
      "invalid_postcondition",
      "assertions array must not be empty",
    );
  }
  return items.map(parseAssertion);
}

function parseAssertion(value: unknown): AssertionSpec {
  if (typeof value !== "object" || value === null) {
    throw new PostconditionError(
      "invalid_postcondition",
      "postcondition assertion must be an object",
    );
  }
  const obj = value as Record<string, unknown>;
  const typeName = obj["type"];
  if (typeof typeName !== "string") {
    throw new PostconditionError(
      "invalid_postcondition",
      "postcondition assertion missing 'type' field",
    );
  }

  switch (typeName) {
    case "http_status": {
      const equals = obj["equals"];
      if (typeof equals !== "number" || !Number.isInteger(equals)) {
        throw new PostconditionError(
          "invalid_postcondition",
          "http_status assertion requires numeric 'equals'",
        );
      }
      if (equals < 0 || equals > 65535) {
        throw new PostconditionError(
          "invalid_postcondition",
          "http_status 'equals' must fit in u16",
        );
      }
      return { type: "http_status", expected: equals };
    }
    case "dom_contains": {
      const text = obj["text"];
      if (typeof text !== "string") {
        throw new PostconditionError(
          "invalid_postcondition",
          "dom_contains assertion requires 'text'",
        );
      }
      const selector =
        typeof obj["selector"] === "string" ? obj["selector"] : undefined;
      const caseInsensitive =
        typeof obj["case_insensitive"] === "boolean"
          ? obj["case_insensitive"]
          : false;
      return { type: "dom_contains", text, selector, case_insensitive: caseInsensitive };
    }
    case "json_path": {
      const path = obj["path"];
      if (typeof path !== "string") {
        throw new PostconditionError(
          "invalid_postcondition",
          "json_path assertion requires 'path'",
        );
      }
      const expected = obj["equals"];
      if (expected === undefined) {
        throw new PostconditionError(
          "invalid_postcondition",
          "json_path assertion requires 'equals'",
        );
      }
      return { type: "json_path_equals", path, expected };
    }
    default:
      throw new PostconditionError(
        "unsupported_postcondition",
        typeName,
      );
  }
}

function evaluateAssertion(
  spec: AssertionSpec,
  context: EvaluationContext,
): AssertionResult {
  switch (spec.type) {
    case "http_status": {
      if (context.http == null) {
        throw new PostconditionError(
          "missing_evidence",
          "http context required for http_status assertion",
        );
      }
      if (context.http.status === spec.expected) {
        return {
          kind: "http_status",
          status: "passed",
          detail: { status: context.http.status },
        };
      }
      return {
        kind: "http_status",
        status: "failed",
        code: "http_status_mismatch",
        message: `expected status ${spec.expected}, observed ${context.http.status}`,
        expected: { status: spec.expected },
        observed: { status: context.http.status },
      };
    }
    case "dom_contains": {
      if (context.dom == null) {
        throw new PostconditionError(
          "missing_evidence",
          "dom context required for dom_contains assertion",
        );
      }
      const haystack = context.dom.html;
      const needle = spec.text;
      const found = spec.case_insensitive
        ? haystack.toLowerCase().includes(needle.toLowerCase())
        : haystack.includes(needle);

      if (found) {
        return {
          kind: "dom_contains",
          status: "passed",
          detail: {
            expected_selector: spec.selector,
            selector: context.dom.selector,
            matched: true,
          },
        };
      }
      return {
        kind: "dom_contains",
        status: "failed",
        code: "dom_text_missing",
        message: "expected DOM excerpt to contain target text",
        expected: REDACTED,
        observed: {
          selector: context.dom.selector,
          expected_selector: spec.selector,
          matched: false,
        },
      };
    }
    case "json_path_equals": {
      if (context.json == null) {
        throw new PostconditionError(
          "missing_evidence",
          "json context required for json_path assertion",
        );
      }
      const tokens = parseJsonPath(spec.path);
      const observed = resolveJsonPath(context.json, tokens);

      if (observed === undefined) {
        return {
          kind: "json_path_equals",
          status: "failed",
          code: "json_path_missing",
          message: `json path '${spec.path}' did not resolve`,
          expected: sanitiseValue(spec.expected),
          observed: undefined,
        };
      }
      if (deepEqual(observed, spec.expected)) {
        return {
          kind: "json_path_equals",
          status: "passed",
          detail: { path: spec.path, value: sanitiseValue(observed) },
        };
      }
      return {
        kind: "json_path_equals",
        status: "failed",
        code: "json_path_predicate_failed",
        message: `json path '${spec.path}' value mismatch`,
        expected: sanitiseValue(spec.expected),
        observed: sanitiseValue(observed),
      };
    }
  }
}

type PathToken = { type: "field"; name: string } | { type: "index"; index: number };

function parseJsonPath(path: string): PathToken[] {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    throw new PostconditionError("invalid_postcondition", "path cannot be empty");
  }
  if (!trimmed.startsWith("$")) {
    throw new PostconditionError("invalid_postcondition", "path must start with '$'");
  }

  const tokens: PathToken[] = [];
  let rest = trimmed.slice(1);

  while (rest.length > 0) {
    if (rest.startsWith(".")) {
      rest = rest.slice(1);
      if (rest.length === 0) {
        throw new PostconditionError(
          "invalid_postcondition",
          "path cannot end with '.'",
        );
      }
      const match = rest.match(/^[^.[]+/);
      if (!match || match[0].length === 0) {
        throw new PostconditionError(
          "invalid_postcondition",
          "field name after '.' cannot be empty",
        );
      }
      tokens.push({ type: "field", name: match[0] });
      rest = rest.slice(match[0].length);
    } else if (rest.startsWith("[")) {
      rest = rest.slice(1);
      const closing = rest.indexOf("]");
      if (closing === -1) {
        throw new PostconditionError(
          "invalid_postcondition",
          "missing closing ']' in index",
        );
      }
      const indexStr = rest.slice(0, closing);
      if (indexStr.length === 0) {
        throw new PostconditionError(
          "invalid_postcondition",
          "array index cannot be empty",
        );
      }
      const index = Number.parseInt(indexStr, 10);
      if (!Number.isInteger(index) || index < 0) {
        throw new PostconditionError(
          "invalid_postcondition",
          "array index must be a non-negative integer",
        );
      }
      tokens.push({ type: "index", index });
      rest = rest.slice(closing + 1);
    } else {
      throw new PostconditionError(
        "invalid_postcondition",
        `unexpected character '${rest[0]}' in path`,
      );
    }
  }

  return tokens;
}

function resolveJsonPath(value: unknown, tokens: PathToken[]): unknown {
  let current = value;
  for (const token of tokens) {
    if (current == null || typeof current !== "object") return undefined;
    if (token.type === "field") {
      current = (current as Record<string, unknown>)[token.name];
    } else {
      if (!Array.isArray(current)) return undefined;
      current = current[token.index];
    }
  }
  return current;
}

function sanitiseValue(value: unknown): unknown {
  if (typeof value === "string") return REDACTED;
  if (Array.isArray(value)) return value.map(sanitiseValue);
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = sanitiseValue(val);
    }
    return result;
  }
  return value;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((item, i) => deepEqual(item, b[i]));
    }
    if (Array.isArray(a) || Array.isArray(b)) return false;
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) =>
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
    );
  }
  return false;
}
