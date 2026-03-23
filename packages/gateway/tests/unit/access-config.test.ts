import { describe, expect, it } from "vitest";
import {
  isAgentAccessAllowed,
  materializeAllowedAgentIds,
} from "../../src/modules/agent/access-config.js";

describe("isAgentAccessAllowed", () => {
  it("returns false for empty id", () => {
    expect(isAgentAccessAllowed({ default_mode: "allow" }, "")).toBe(false);
    expect(isAgentAccessAllowed({ default_mode: "allow" }, "  ")).toBe(false);
  });

  it("uses default_mode=allow when id is not in allow or deny", () => {
    expect(isAgentAccessAllowed({ default_mode: "allow" }, "some-skill")).toBe(true);
  });

  it("uses default_mode=deny when id is not in allow or deny", () => {
    expect(isAgentAccessAllowed({ default_mode: "deny" }, "some-skill")).toBe(false);
  });

  it("defaults to deny when default_mode is unspecified", () => {
    expect(isAgentAccessAllowed({}, "some-skill")).toBe(false);
  });

  it("denies when id is in the deny list", () => {
    expect(
      isAgentAccessAllowed({ default_mode: "allow", deny: ["blocked-skill"] }, "blocked-skill"),
    ).toBe(false);
  });

  it("allows when id is in the allow list", () => {
    expect(
      isAgentAccessAllowed({ default_mode: "deny", allow: ["special-skill"] }, "special-skill"),
    ).toBe(true);
  });

  it("deny takes precedence over allow", () => {
    expect(
      isAgentAccessAllowed(
        { default_mode: "deny", allow: ["skill-a"], deny: ["skill-a"] },
        "skill-a",
      ),
    ).toBe(false);
  });

  it("supports wildcard patterns in allow list", () => {
    expect(
      isAgentAccessAllowed({ default_mode: "deny", allow: ["mcp.*"] }, "mcp.memory.seed"),
    ).toBe(true);
  });

  it("supports wildcard patterns in deny list", () => {
    expect(
      isAgentAccessAllowed({ default_mode: "allow", deny: ["sandbox.*"] }, "sandbox.request"),
    ).toBe(false);
  });

  it("handles missing allow/deny lists gracefully", () => {
    expect(isAgentAccessAllowed({ default_mode: "allow" }, "test")).toBe(true);
  });
});

describe("materializeAllowedAgentIds", () => {
  it("filters items to only those that are allowed", () => {
    const config = { default_mode: "deny" as const, allow: ["a", "c"] };
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(materializeAllowedAgentIds(config, items)).toEqual([{ id: "a" }, { id: "c" }]);
  });

  it("deduplicates by id", () => {
    const config = { default_mode: "allow" as const };
    const items = [{ id: "a" }, { id: "a" }, { id: "b" }];
    expect(materializeAllowedAgentIds(config, items)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("skips items with empty id", () => {
    const config = { default_mode: "allow" as const };
    const items = [{ id: "" }, { id: "  " }, { id: "valid" }];
    expect(materializeAllowedAgentIds(config, items)).toEqual([{ id: "valid" }]);
  });

  it("returns empty array when nothing is allowed", () => {
    const config = { default_mode: "deny" as const };
    const items = [{ id: "a" }, { id: "b" }];
    expect(materializeAllowedAgentIds(config, items)).toEqual([]);
  });

  it("respects deny list", () => {
    const config = { default_mode: "allow" as const, deny: ["b"] };
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(materializeAllowedAgentIds(config, items)).toEqual([{ id: "a" }, { id: "c" }]);
  });
});
