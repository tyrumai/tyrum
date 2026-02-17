import { describe, expect, it } from "vitest";
import {
  AgentConfig,
  IdentityPack,
  SkillManifest,
  McpServerSpec,
  AgentTurnRequest,
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
    expect(parsed.memory.markdown_enabled).toBe(true);
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
