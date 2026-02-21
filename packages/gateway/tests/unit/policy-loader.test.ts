import { describe, expect, it, vi } from "vitest";
import { stringify as stringifyYaml } from "yaml";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

import { readFileSync } from "node:fs";
import { loadPolicyBundle } from "../../src/modules/policy/loader.js";

const mockedReadFileSync = vi.mocked(readFileSync);

function validBundle() {
  return {
    rules: [
      {
        domain: "spend",
        action: "deny",
        priority: 1,
        description: "Block high spend",
      },
    ],
    precedence: "deployment",
    version: "1.0.0",
  };
}

describe("loadPolicyBundle", () => {
  it("loads valid JSON policy bundle", () => {
    const bundle = validBundle();
    mockedReadFileSync.mockReturnValue(JSON.stringify(bundle));

    const result = loadPolicyBundle("/policies/test.json");

    expect(mockedReadFileSync).toHaveBeenCalledWith("/policies/test.json", "utf-8");
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]!.domain).toBe("spend");
    expect(result.precedence).toBe("deployment");
  });

  it("loads valid YAML (.yaml extension) policy bundle", () => {
    const bundle = validBundle();
    mockedReadFileSync.mockReturnValue(stringifyYaml(bundle));

    const result = loadPolicyBundle("/policies/test.yaml");

    expect(result.rules).toHaveLength(1);
    expect(result.precedence).toBe("deployment");
  });

  it("loads valid YAML (.yml extension) policy bundle", () => {
    const bundle = validBundle();
    mockedReadFileSync.mockReturnValue(stringifyYaml(bundle));

    const result = loadPolicyBundle("/policies/test.yml");

    expect(result.rules).toHaveLength(1);
    expect(result.precedence).toBe("deployment");
  });

  it("throws for invalid schema content", () => {
    mockedReadFileSync.mockReturnValue(JSON.stringify({ rules: "not-an-array" }));

    expect(() => loadPolicyBundle("/policies/bad.json")).toThrow(
      /Invalid policy bundle at \/policies\/bad\.json/,
    );
  });

  it("throws when file read fails", () => {
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    expect(() => loadPolicyBundle("/policies/missing.json")).toThrow("ENOENT");
  });
});
