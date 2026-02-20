import { afterEach, describe, expect, it } from "vitest";
import { isAgentEnabled } from "../../src/modules/agent/enabled.js";

describe("isAgentEnabled", () => {
  const original = process.env["TYRUM_AGENT_ENABLED"];

  afterEach(() => {
    if (original === undefined) {
      delete process.env["TYRUM_AGENT_ENABLED"];
    } else {
      process.env["TYRUM_AGENT_ENABLED"] = original;
    }
  });

  it("defaults to enabled when unset", () => {
    delete process.env["TYRUM_AGENT_ENABLED"];
    expect(isAgentEnabled()).toBe(true);
  });

  it("treats common disabled values as disabled", () => {
    const disabled = ["0", "false", "off", "no"];
    for (const value of disabled) {
      process.env["TYRUM_AGENT_ENABLED"] = value;
      expect(isAgentEnabled()).toBe(false);
    }
  });

  it("treats other values as enabled", () => {
    const enabled = ["1", "true", "on", "yes", "something-else"];
    for (const value of enabled) {
      process.env["TYRUM_AGENT_ENABLED"] = value;
      expect(isAgentEnabled()).toBe(true);
    }
  });
});

