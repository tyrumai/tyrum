import { describe, expect, it } from "vitest";
import { canonicalizeToolMatchTarget } from "../../src/modules/policy/match-target.js";

describe("canonicalizeToolMatchTarget", () => {
  const canonicalizeWithHome = (toolId: string, args: unknown, home: string): string =>
    canonicalizeToolMatchTarget(toolId, args, home);

  it("canonicalizes fs paths with stable workspace-relative formatting", () => {
    const target = canonicalizeToolMatchTarget("read", {
      path: " ./docs//architecture/gateway/./policy-overrides.md ",
    });

    expect(target).toBe("read:docs/architecture/gateway/policy-overrides.md");
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
      { path: "/workspace/docs//architecture/gateway/./policy-overrides.md" },
      "/workspace",
    );

    expect(target).toBe("read:docs/architecture/gateway/policy-overrides.md");
  });

  it("canonicalizes Windows drive paths within the workspace to workspace-relative targets", () => {
    const target = canonicalizeWithHome(
      "read",
      { path: "C:\\workspace\\docs\\architecture\\gateway\\policy-overrides.md" },
      "C:\\workspace",
    );

    expect(target).toBe("read:docs/architecture/gateway/policy-overrides.md");
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

  it("canonicalizes builtin memory MCP tool targets without leaking memory content", () => {
    expect(
      canonicalizeToolMatchTarget("mcp.memory.search", {
        query: "remember my pizza order",
      }),
    ).toBe("mcp.memory.search");

    expect(
      canonicalizeToolMatchTarget("mcp.memory.write", {
        kind: "note",
        body_md: "super secret content",
        sensitivity: "private",
      }),
    ).toBe("mcp.memory.write");
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

  it("canonicalizes dedicated desktop routed tools to the exact dedicated tool id", () => {
    expect(
      canonicalizeToolMatchTarget("tool.desktop.snapshot", {
        node_id: "node-1",
        display: "all",
      }),
    ).toBe("tool.desktop.snapshot");
    expect(
      canonicalizeToolMatchTarget("tool.desktop.act", {
        node_id: "node-1",
        target: { kind: "a11y", role: "button", name: "Save" },
        action: { kind: "click" },
      }),
    ).toBe("tool.desktop.act");
  });

  it("canonicalizes dedicated browser and sensor routed tools to their exact dedicated tool ids", () => {
    expect(
      canonicalizeToolMatchTarget("tool.browser.navigate", {
        node_id: "node-1",
        url: "https://example.com",
      }),
    ).toBe("tool.browser.navigate");
    expect(
      canonicalizeToolMatchTarget("tool.location.get", {
        enable_high_accuracy: true,
      }),
    ).toBe("tool.location.get");
    expect(
      canonicalizeToolMatchTarget("tool.camera.capture-photo", {
        node_id: "node-1",
        facing_mode: "environment",
      }),
    ).toBe("tool.camera.capture-photo");
    expect(
      canonicalizeToolMatchTarget("tool.audio.record", {
        node_id: "node-1",
        duration_ms: 5000,
      }),
    ).toBe("tool.audio.record");
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

  it("canonicalizes location place scope actions to the explicit or resolved current agent scope", () => {
    expect(canonicalizeToolMatchTarget("tool.location.place.list", {}, undefined, "default")).toBe(
      "agent_key:default",
    );
    expect(canonicalizeToolMatchTarget("tool.location.place.list", {})).toBe("agent_key:current");
    expect(
      canonicalizeToolMatchTarget(
        "tool.location.place.create",
        {
          agent_key: "travel",
          name: "Hotel",
          latitude: 52.37,
          longitude: 4.89,
        },
        undefined,
        "default",
      ),
    ).toBe("agent_key:travel");
  });

  it("canonicalizes direct location place actions to the exact place id", () => {
    expect(
      canonicalizeToolMatchTarget("tool.location.place.update", {
        place_id: "11111111-1111-1111-1111-111111111111",
        name: "Home Base",
      }),
    ).toBe("place_id:11111111-1111-1111-1111-111111111111");
    expect(
      canonicalizeToolMatchTarget("tool.location.place.delete", {
        place_id: "11111111-1111-1111-1111-111111111111",
      }),
    ).toBe("place_id:11111111-1111-1111-1111-111111111111");
  });
});
