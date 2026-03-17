import { describe, expect, it } from "vitest";
import { normalizeSessionTitle } from "../../src/modules/agent/session-dal-helpers.js";

describe("normalizeSessionTitle", () => {
  it("rejects low-signal generic titles", () => {
    expect(normalizeSessionTitle("Need help")).toBe("");
    expect(normalizeSessionTitle("Question")).toBe("");
    expect(normalizeSessionTitle("New conversation")).toBe("");
  });

  it("keeps specific titles intact", () => {
    expect(normalizeSessionTitle("Debug guardian review prompt drift")).toBe(
      "Debug guardian review prompt drift",
    );
  });
});
