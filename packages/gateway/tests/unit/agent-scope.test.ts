import { describe, it, expect, afterEach } from "vitest";
import { resolveAgentId, isMultiAgentEnabled, withAgentScope } from "../../src/modules/agent/agent-scope.js";

describe("agent-scope", () => {
  const originalEnv = process.env["TYRUM_MULTI_AGENT"];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["TYRUM_MULTI_AGENT"];
    } else {
      process.env["TYRUM_MULTI_AGENT"] = originalEnv;
    }
  });

  describe("isMultiAgentEnabled", () => {
    it("returns false by default", () => {
      delete process.env["TYRUM_MULTI_AGENT"];
      expect(isMultiAgentEnabled()).toBe(false);
    });

    it("returns true when set to 1", () => {
      process.env["TYRUM_MULTI_AGENT"] = "1";
      expect(isMultiAgentEnabled()).toBe(true);
    });

    it("returns false when set to 0", () => {
      process.env["TYRUM_MULTI_AGENT"] = "0";
      expect(isMultiAgentEnabled()).toBe(false);
    });
  });

  describe("resolveAgentId", () => {
    it("returns default when multi-agent is off", () => {
      delete process.env["TYRUM_MULTI_AGENT"];
      expect(resolveAgentId("agent-1")).toBe("default");
    });

    it("returns provided id when multi-agent is on", () => {
      process.env["TYRUM_MULTI_AGENT"] = "1";
      expect(resolveAgentId("agent-1")).toBe("agent-1");
    });

    it("returns default when id is empty and multi-agent is on", () => {
      process.env["TYRUM_MULTI_AGENT"] = "1";
      expect(resolveAgentId("")).toBe("default");
    });

    it("returns default when id is undefined and multi-agent is on", () => {
      process.env["TYRUM_MULTI_AGENT"] = "1";
      expect(resolveAgentId(undefined)).toBe("default");
    });
  });

  describe("withAgentScope", () => {
    it("appends WHERE clause when none exists", () => {
      const result = withAgentScope("SELECT * FROM facts", "agent-1", []);
      expect(result.query).toBe("SELECT * FROM facts WHERE agent_id = ?");
      // Multi-agent off by default, so resolved to 'default'
      expect(result.params).toEqual(["default"]);
    });

    it("appends AND clause when WHERE exists", () => {
      const result = withAgentScope(
        "SELECT * FROM facts WHERE id = ?",
        "agent-1",
        [42],
      );
      expect(result.query).toBe("SELECT * FROM facts WHERE id = ? AND agent_id = ?");
      expect(result.params).toEqual([42, "default"]);
    });

    it("uses provided agent_id when multi-agent is on", () => {
      process.env["TYRUM_MULTI_AGENT"] = "1";
      const result = withAgentScope("SELECT * FROM facts", "agent-1", []);
      expect(result.params).toEqual(["agent-1"]);
    });
  });
});
