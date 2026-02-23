import { describe, expect, it } from "vitest";
import { canonicalizeToolMatchTarget } from "../../src/modules/policy/match-target.js";

describe("canonicalizeToolMatchTarget", () => {
  it("canonicalizes fs paths with stable workspace-relative formatting", () => {
    const target = canonicalizeToolMatchTarget(
      "tool.fs.read",
      { path: " ./docs//architecture/../policy-overrides.md " },
    );

    expect(target).toBe("read:docs/policy-overrides.md");
  });

  it("canonicalizes exec commands by collapsing non-semantic whitespace", () => {
    const target = canonicalizeToolMatchTarget(
      "tool.exec",
      { command: "  git   status   --porcelain  " },
    );

    expect(target).toBe("git status --porcelain");
  });

  it("canonicalizes messaging destinations without matching on message body", () => {
    const target = canonicalizeToolMatchTarget(
      "tool.messaging.send",
      {
        connector: " slack ",
        account_id: " acct_123 ",
        thread_id: " chan_C024BE91L ",
        text: "hello from model output",
      },
    );

    expect(target).toBe("send:slack:acct_123:chan_C024BE91L");
  });

  it("canonicalizes mcp tools to a stable id-only target", () => {
    const target = canonicalizeToolMatchTarget(
      "  mcp.calendar.events_list  ",
      { start: "2026-01-01" },
    );

    expect(target).toBe("mcp.calendar.events_list");
  });
});
