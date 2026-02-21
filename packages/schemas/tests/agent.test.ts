import { describe, expect, it } from "vitest";
import {
  AgentConfig,
  IdentityPack,
  SkillManifest,
  McpServerSpec,
  AgentTurnRequest,
  TypingMode,
  TypingConfig,
} from "../src/index.js";

describe("AgentConfig", () => {
  it("parses and applies defaults", () => {
    const parsed = AgentConfig.parse({
      model: {
        model: "frontier-gpt-4o",
      },
    });

    expect(parsed.model.model).toBe("frontier-gpt-4o");
    expect(parsed.skills.enabled).toEqual([]);
    expect(parsed.mcp.enabled).toEqual([]);
    expect(parsed.tools.allow).toEqual([]);
    expect(parsed.sessions.ttl_days).toBe(30);
    expect(parsed.sessions.max_turns).toBe(20);
    expect(parsed.sessions.typing.mode).toBe("message");
    expect(parsed.sessions.typing.refresh_interval_ms).toBe(3000);
    expect(parsed.memory.markdown_enabled).toBe(true);
  });
});

describe("TypingMode", () => {
  it("accepts all four typing modes", () => {
    for (const mode of ["never", "message", "thinking", "instant"] as const) {
      expect(TypingMode.parse(mode)).toBe(mode);
    }
  });

  it("rejects invalid typing mode", () => {
    expect(TypingMode.safeParse("auto").success).toBe(false);
  });
});

describe("TypingConfig", () => {
  it("applies defaults", () => {
    const parsed = TypingConfig.parse({});
    expect(parsed.mode).toBe("message");
    expect(parsed.refresh_interval_ms).toBe(3000);
  });

  it("accepts custom values", () => {
    const parsed = TypingConfig.parse({ mode: "instant", refresh_interval_ms: 1000 });
    expect(parsed.mode).toBe("instant");
    expect(parsed.refresh_interval_ms).toBe(1000);
  });

  it("rejects out-of-range refresh interval", () => {
    expect(TypingConfig.safeParse({ refresh_interval_ms: 50000 }).success).toBe(false);
  });
});

describe("IdentityPack", () => {
  it("parses a valid identity payload", () => {
    const parsed = IdentityPack.parse({
      meta: {
        name: "Tyrum",
        style: {
          tone: "direct",
          verbosity: "concise",
        },
      },
      body: "You are Tyrum.",
    });

    expect(parsed.meta.name).toBe("Tyrum");
    expect(parsed.body).toContain("Tyrum");
  });
});

describe("SkillManifest", () => {
  it("requires id, name, and version", () => {
    const parsed = SkillManifest.parse({
      meta: {
        id: "local-files",
        name: "Local Files",
        version: "1.0.0",
        requires: {
          tools: ["tool.fs.read"],
        },
      },
      body: "Use filesystem tools carefully.",
    });

    expect(parsed.meta.id).toBe("local-files");
    expect(parsed.meta.requires?.tools).toEqual(["tool.fs.read"]);
  });
});

describe("McpServerSpec", () => {
  it("parses stdio server configuration", () => {
    const parsed = McpServerSpec.parse({
      id: "calendar",
      name: "Calendar MCP",
      enabled: true,
      transport: "stdio",
      command: "node",
      args: ["./mcp/calendar.js"],
      env: {
        CALENDAR_TOKEN: "${CALENDAR_TOKEN}",
      },
    });

    expect(parsed.transport).toBe("stdio");
    expect(parsed.command).toBe("node");
  });

  it("parses remote server configuration", () => {
    const parsed = McpServerSpec.parse({
      id: "calendar-remote",
      name: "Calendar MCP (Remote)",
      enabled: true,
      transport: "remote",
      url: "https://mcp.example.com/mcp",
      headers: {
        authorization: "Bearer ${MCP_TOKEN}",
      },
    });

    expect(parsed.transport).toBe("remote");
    expect(parsed.url).toBe("https://mcp.example.com/mcp");
  });
});

describe("AgentTurnRequest", () => {
  it("rejects blank message content", () => {
    const parsed = AgentTurnRequest.safeParse({
      channel: "telegram",
      thread_id: "123",
      message: "   ",
    });

    expect(parsed.success).toBe(false);
  });
});
