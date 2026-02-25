import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  MAX_OUTPUT_BYTES_HARD_LIMIT,
  parsePlaybookOutputContract,
  resolveMaxOutputBytes,
  validateJsonAgainstSchema,
} from "../../src/modules/execution/playbook-output-contract.js";

describe("playbook output-contract utilities", () => {
  it("parses shorthand output kinds", () => {
    const json = parsePlaybookOutputContract({ __playbook: { output: "json" } });
    expect(json).toEqual({ kind: "json" });

    const text = parsePlaybookOutputContract({ __playbook: { output: "text" } });
    expect(text).toEqual({ kind: "text" });
  });

  it("parses object output contracts with schema", () => {
    const contract = parsePlaybookOutputContract({
      __playbook: { output: { type: "json", schema: { type: "object" } } },
    });
    expect(contract).toEqual({ kind: "json", schema: { type: "object" } });
  });

  it("resolves max_output_bytes defaults and clamps to hard limit", () => {
    expect(resolveMaxOutputBytes({})).toBe(DEFAULT_MAX_OUTPUT_BYTES);
    expect(resolveMaxOutputBytes({ max_output_bytes: 1 })).toBe(1);
    expect(resolveMaxOutputBytes({ max_output_bytes: MAX_OUTPUT_BYTES_HARD_LIMIT + 10 })).toBe(MAX_OUTPUT_BYTES_HARD_LIMIT);
    expect(resolveMaxOutputBytes({ max_output_bytes: 0 })).toBe(DEFAULT_MAX_OUTPUT_BYTES);
    expect(resolveMaxOutputBytes({ max_output_bytes: -5 })).toBe(DEFAULT_MAX_OUTPUT_BYTES);
  });

  it("validates JSON values against JSON Schema", () => {
    const schema = {
      type: "object",
      required: ["ok"],
      properties: { ok: { const: true } },
      additionalProperties: false,
    };
    expect(validateJsonAgainstSchema({ ok: true }, schema)).toBeUndefined();

    const err = validateJsonAgainstSchema({ ok: false }, schema);
    expect(typeof err).toBe("string");
    expect(err?.length).toBeGreaterThan(0);
  });
});

