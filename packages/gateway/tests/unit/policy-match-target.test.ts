import { describe, expect, it } from "vitest";
import { canonicalizeToolMatchTarget } from "../../src/modules/policy/match-target.js";

describe("canonicalizeToolMatchTarget", () => {
  const canonicalizeWithHome = (toolId: string, args: unknown, home: string): string =>
    canonicalizeToolMatchTarget(toolId, args, home);

  it("canonicalizes fs paths with stable workspace-relative formatting", () => {
    const target = canonicalizeToolMatchTarget("read", {
      path: " ./docs//architecture/../policy-overrides.md ",
    });

    expect(target).toBe("read:docs/policy-overrides.md");
  });

  it("rejects parent traversal that would escape the workspace boundary", () => {
    const target = canonicalizeToolMatchTarget("read", { path: "a/../../b" });

    // Match targets for fs must be workspace-relative and must not contain "..".
    expect(target).toBe("read:");
  });

  it("rejects absolute fs paths that escape the workspace boundary", () => {
    const target = canonicalizeWithHome("read", { path: "/etc/passwd" }, "/workspace");

    expect(target).toBe("read:");
  });

  it("canonicalizes absolute fs paths within the workspace to workspace-relative targets", () => {
    const target = canonicalizeWithHome(
      "read",
      { path: "/workspace/docs//architecture/../policy-overrides.md" },
      "/workspace",
    );

    expect(target).toBe("read:docs/policy-overrides.md");
  });

  it("canonicalizes Windows drive paths within the workspace to workspace-relative targets", () => {
    const target = canonicalizeWithHome(
      "read",
      { path: "C:\\workspace\\docs\\policy-overrides.md" },
      "C:\\workspace",
    );

    expect(target).toBe("read:docs/policy-overrides.md");
  });

  it("canonicalizes '.' to an explicit workspace-root target", () => {
    const target = canonicalizeToolMatchTarget("read", { path: "." });

    expect(target).toBe("read:.");
  });

  it("canonicalizes exec commands by collapsing non-semantic whitespace", () => {
    const target = canonicalizeToolMatchTarget("bash", {
      command: "  git   status   --porcelain  ",
    });

    expect(target).toBe("git status --porcelain");
  });

  it("canonicalizes http fetch urls by stripping fragments (and query params)", () => {
    expect(
      canonicalizeToolMatchTarget("webfetch", {
        url: "https://example.com/a?token=secret#frag",
      }),
    ).toBe("https://example.com/a");

    expect(
      canonicalizeToolMatchTarget("webfetch", {
        url: "https://example.com/a#access_token=secret",
      }),
    ).toBe("https://example.com/a");
  });

  it("canonicalizes memory tool targets without leaking memory content", () => {
    expect(
      canonicalizeToolMatchTarget("memory.search", {
        query: "remember my pizza order",
      }),
    ).toBe("memory.search");

    expect(
      canonicalizeToolMatchTarget("memory.add", {
        kind: "note",
        body_md: "super secret content",
        sensitivity: "private",
      }),
    ).toBe("memory.add:kind=note:sensitivity=private");
  });

  it("canonicalizes messaging destinations without matching on message body", () => {
    const target = canonicalizeToolMatchTarget("tool.messaging.send", {
      connector: " slack ",
      account_id: " acct_123 ",
      thread_id: " chan_C024BE91L ",
      text: "hello from model output",
    });

    expect(target).toBe("send:slack:acct_123:chan_C024BE91L");
  });

  it("does not misclassify non-messaging tool ids that share a prefix with tool.channel.send", () => {
    const target = canonicalizeToolMatchTarget("tool.channel.sendbird", {});

    expect(target).toBe("tool.channel.sendbird");
  });

  it("treats tool.channel.send as a messaging tool id (exact match)", () => {
    const target = canonicalizeToolMatchTarget("tool.channel.send", {
      connector: "slack",
      account_id: "acct_123",
      thread_id: "chan_C024BE91L",
      text: "hello",
    });

    expect(target).toBe("send:slack:acct_123:chan_C024BE91L");
  });

  it("canonicalizes mcp tools to a stable id-only target", () => {
    const target = canonicalizeToolMatchTarget("  mcp.calendar.events_list  ", {
      start: "2026-01-01",
    });

    expect(target).toBe("mcp.calendar.events_list");
  });

  it("canonicalizes desktop node dispatch by capability + action + desktop op", () => {
    const target = canonicalizeToolMatchTarget("tool.node.dispatch", {
      capability: "tyrum.desktop",
      action_name: "snapshot",
      input: { secret: "should-not-appear" },
    });

    expect(target).toBe("capability:tyrum.desktop;action:Desktop;op:snapshot");
  });

  it("canonicalizes nested desktop args wrappers for node dispatch without leaking values", () => {
    const target = canonicalizeToolMatchTarget("tool.node.dispatch", {
      capability: "tyrum.desktop",
      action_name: "snapshot",
      input: { secret: "should-not-appear" },
    });

    expect(target).toBe("capability:tyrum.desktop;action:Desktop;op:snapshot");
    expect(target).not.toContain("secret");
  });

  it("canonicalizes other desktop ops without leaking high-entropy values", () => {
    const queryTarget = canonicalizeToolMatchTarget("tool.node.dispatch", {
      capability: "tyrum.desktop",
      action_name: "query",
      input: { selector: { kind: "a11y", role: "button", name: "Save" } },
    });
    expect(queryTarget).toBe("capability:tyrum.desktop;action:Desktop;op:query");
    expect(queryTarget).not.toContain("Save");

    const waitForTarget = canonicalizeToolMatchTarget("tool.node.dispatch", {
      capability: "tyrum.desktop",
      action_name: "wait_for",
      input: {
        selector: { kind: "ocr", text: "2FA code", bounds: { x: 1, y: 2, width: 3, height: 4 } },
      },
    });
    expect(waitForTarget).toBe("capability:tyrum.desktop;action:Desktop;op:wait_for");
    expect(waitForTarget).not.toContain("2FA");

    const screenshotTarget = canonicalizeToolMatchTarget("tool.node.dispatch", {
      capability: "tyrum.desktop",
      action_name: "screenshot",
      input: { display: "primary" },
    });
    expect(screenshotTarget).toBe("capability:tyrum.desktop;action:Desktop;op:snapshot");

    const unknownTarget = canonicalizeToolMatchTarget("tool.node.dispatch", {
      capability: "tyrum.desktop",
      action_name: "not-a-real-op",
      input: { text: "secret" },
    });
    expect(unknownTarget).toBe("capability:tyrum.desktop;action:Desktop;op:unknown");
    expect(unknownTarget).not.toContain("secret");
  });

  it("groups legacy desktop mouse/keyboard ops under op:act with a minimal subtype", () => {
    const mouseTarget = canonicalizeToolMatchTarget("tool.node.dispatch", {
      capability: "tyrum.desktop",
      action_name: "mouse",
      input: { action: "click", x: 1, y: 2 },
    });
    expect(mouseTarget).toBe("capability:tyrum.desktop;action:Desktop;op:act;act:mouse");

    const keyboardTarget = canonicalizeToolMatchTarget("tool.node.dispatch", {
      capability: "tyrum.desktop",
      action_name: "keyboard",
      input: { action: "type", text: "secret" },
    });
    expect(keyboardTarget).toBe("capability:tyrum.desktop;action:Desktop;op:act;act:keyboard");
    expect(keyboardTarget).not.toContain("secret");

    const actTarget = canonicalizeToolMatchTarget("tool.node.dispatch", {
      capability: "tyrum.desktop",
      action_name: "act",
      input: {
        target: { kind: "ref", ref: "pixel:1,2" },
        action: { kind: "click" },
      },
    });
    expect(actTarget).toBe("capability:tyrum.desktop;action:Desktop;op:act;act:ui");
    expect(actTarget).not.toContain("pixel:");
  });

  it("canonicalizes browser node dispatch by capability + action + browser op", () => {
    const geoTarget = canonicalizeToolMatchTarget("tool.node.dispatch", {
      capability: "tyrum.browser",
      action_name: "geolocation.get",
      input: { enable_high_accuracy: true },
    });
    expect(geoTarget).toBe("capability:tyrum.browser;action:Browser;op:geolocation.get");
    expect(geoTarget).not.toContain("enable_high_accuracy");

    const unknownTarget = canonicalizeToolMatchTarget("tool.node.dispatch", {
      capability: "tyrum.browser",
      action_name: "not-a-real-op",
      input: { secret: "should-not-appear" },
    });
    expect(unknownTarget).toBe("capability:tyrum.browser;action:Browser;op:unknown");
    expect(unknownTarget).not.toContain("secret");
  });

  it("canonicalizes heartbeat schedule creation using normalized schedule semantics", () => {
    const target = canonicalizeToolMatchTarget("tool.automation.schedule.create", {
      kind: "heartbeat",
      cadence: { type: "interval", interval_ms: 1_800_000 },
      execution: {
        kind: "agent_turn",
        instruction: "Review everything and summarize",
      },
      workspace_key: "workspace-alpha",
    });

    expect(target).toBe(
      "kind:heartbeat;execution:agent_turn;delivery:quiet;workspace_key:workspace-alpha",
    );
    expect(target).not.toContain("Review everything");
    expect(target).not.toContain("1800000");
  });

  it("canonicalizes playbook schedule creation with the playbook id but not cadence details", () => {
    const target = canonicalizeToolMatchTarget("tool.automation.schedule.create", {
      kind: "cron",
      cadence: { type: "cron", expression: "0 * * * *", timezone: "UTC" },
      execution: {
        kind: "playbook",
        playbook_id: "playbook-123",
      },
      agent_key: "agent-alpha",
    });

    expect(target).toBe(
      "kind:cron;execution:playbook;delivery:notify;agent_key:agent-alpha;playbook_id:playbook-123",
    );
    expect(target).not.toContain("0 * * * *");
  });

  it("canonicalizes schedule update targets around the exact schedule id", () => {
    const target = canonicalizeToolMatchTarget("tool.automation.schedule.update", {
      schedule_id: "11111111-1111-1111-1111-111111111111",
      kind: "heartbeat",
      delivery: { mode: "quiet" },
    });

    expect(target).toBe(
      "schedule_id:11111111-1111-1111-1111-111111111111;kind:heartbeat;delivery:quiet",
    );
  });

  it("canonicalizes direct schedule actions to the exact schedule id", () => {
    expect(
      canonicalizeToolMatchTarget("tool.automation.schedule.pause", {
        schedule_id: "11111111-1111-1111-1111-111111111111",
      }),
    ).toBe("schedule_id:11111111-1111-1111-1111-111111111111");
    expect(
      canonicalizeToolMatchTarget("tool.automation.schedule.delete", {
        schedule_id: "11111111-1111-1111-1111-111111111111",
      }),
    ).toBe("schedule_id:11111111-1111-1111-1111-111111111111");
  });
});
