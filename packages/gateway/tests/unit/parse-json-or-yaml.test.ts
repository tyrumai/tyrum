import { describe, expect, it } from "vitest";
import { isRecord, parseJsonOrYaml } from "../../src/utils/parse-json-or-yaml.js";

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2, 3])).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isRecord("string")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe("parseJsonOrYaml", () => {
  it("returns empty object for empty string", () => {
    expect(parseJsonOrYaml("")).toEqual({});
  });

  it("returns empty object for whitespace-only string", () => {
    expect(parseJsonOrYaml("   ")).toEqual({});
  });

  it("parses JSON when content starts with {", () => {
    expect(parseJsonOrYaml('{"key": "value"}')).toEqual({ key: "value" });
  });

  it("parses JSON when hintPath ends with .json", () => {
    expect(parseJsonOrYaml('{"key": "value"}', "config.json")).toEqual({ key: "value" });
  });

  it("parses JSON case-insensitively for .json hint", () => {
    expect(parseJsonOrYaml('{"key": "value"}', "config.JSON")).toEqual({ key: "value" });
  });

  it("parses YAML when no JSON hint", () => {
    expect(parseJsonOrYaml("key: value")).toEqual({ key: "value" });
  });

  it("parses YAML when hintPath is a .yaml file", () => {
    expect(parseJsonOrYaml("key: value", "config.yaml")).toEqual({ key: "value" });
  });

  it("parses YAML with nested structure", () => {
    const yaml = "parent:\n  child: value";
    expect(parseJsonOrYaml(yaml)).toEqual({ parent: { child: "value" } });
  });

  it("throws for malformed JSON with .json hint", () => {
    expect(() => parseJsonOrYaml("{bad json}", "config.json")).toThrow();
  });

  it("prefers JSON parsing when content starts with { and no hintPath", () => {
    const content = '{"list": [1, 2, 3]}';
    expect(parseJsonOrYaml(content)).toEqual({ list: [1, 2, 3] });
  });

  it("uses YAML parsing for non-{ content without .json hint", () => {
    const content = "items:\n  - one\n  - two";
    expect(parseJsonOrYaml(content)).toEqual({ items: ["one", "two"] });
  });
});
