import { describe, expect, it } from "vitest";
import { canonicalizeToolMatchTarget } from "../../src/modules/policy/match-target.js";

describe("canonicalizeToolMatchTarget", () => {
  const canonicalizeWithHome = (
    toolId: string,
    args: unknown,
    home: string,
  ): string =>
    canonicalizeToolMatchTarget(toolId, args, home);

  it("canonicalizes fs paths with stable workspace-relative formatting", () => {
    const target = canonicalizeToolMatchTarget(
      "tool.fs.read",
      { path: " ./docs//architecture/../policy-overrides.md " },
    );

    expect(target).toBe("read:docs/policy-overrides.md");
  });

  it("rejects parent traversal that would escape the workspace boundary", () => {
    const target = canonicalizeToolMatchTarget(
      "tool.fs.read",
      { path: "a/../../b" },
    );

    // Match targets for fs must be workspace-relative and must not contain "..".
    expect(target).toBe("read:");
  });

  it("rejects absolute fs paths that escape the workspace boundary", () => {
    const target = canonicalizeWithHome(
      "tool.fs.read",
      { path: "/etc/passwd" },
      "/workspace",
    );

    expect(target).toBe("read:");
  });

  it("canonicalizes absolute fs paths within the workspace to workspace-relative targets", () => {
    const target = canonicalizeWithHome(
      "tool.fs.read",
      { path: "/workspace/docs//architecture/../policy-overrides.md" },
      "/workspace",
    );

    expect(target).toBe("read:docs/policy-overrides.md");
  });

  it("canonicalizes Windows drive paths within the workspace to workspace-relative targets", () => {
    const target = canonicalizeWithHome(
      "tool.fs.read",
      { path: "C:\\workspace\\docs\\policy-overrides.md" },
      "C:\\workspace",
    );

    expect(target).toBe("read:docs/policy-overrides.md");
  });

  it("canonicalizes '.' to an explicit workspace-root target", () => {
    const target = canonicalizeToolMatchTarget(
      "tool.fs.read",
      { path: "." },
    );

    expect(target).toBe("read:.");
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

  it("does not misclassify non-messaging tool ids that share a prefix with tool.channel.send", () => {
    const target = canonicalizeToolMatchTarget(
      "tool.channel.sendbird",
      {},
    );

    expect(target).toBe("tool.channel.sendbird");
  });

  it("treats tool.channel.send as a messaging tool id (exact match)", () => {
    const target = canonicalizeToolMatchTarget(
      "tool.channel.send",
      {
        connector: "slack",
        account_id: "acct_123",
        thread_id: "chan_C024BE91L",
        text: "hello",
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
