import type { IdentityPack } from "@tyrum/contracts";
import { describe, expect, it } from "vitest";
import {
  formatIdentityPrompt,
  formatMemoryGuidancePrompt,
  formatSkillsPrompt,
  formatToolPrompt,
} from "../../src/modules/agent/runtime/prompts.js";
import type { ToolDescriptor } from "../../src/modules/agent/tools.js";

describe("formatSkillsPrompt", () => {
  it("includes inline skill instructions with provenance metadata", () => {
    const prompt = formatSkillsPrompt([
      {
        body: "Keep responses terse.",
        meta: {
          id: "skill-1",
          name: "Terse Mode",
          version: "1.0.0",
          description: "Respond briefly",
        },
        provenance: {
          source: "workspace",
          path: "/tmp/skills/terse.md",
        },
      },
    ]);

    expect(prompt).toContain("Use the relevant skill only when the task matches it.");
    expect(prompt).toContain("Skills are workflow hints.");
    expect(prompt).toContain("Terse Mode (skill-1@1.0.0)");
    expect(prompt).toContain("description=Respond briefly");
    expect(prompt).toContain("source=workspace");
    expect(prompt).toContain("file=/tmp/skills/terse.md");
    expect(prompt).toContain("Keep responses terse.");
  });

  it("includes database-backed skill bodies even without a readable file path", () => {
    const prompt = formatSkillsPrompt([
      {
        body: "Escalate approval requests before running deploy actions.",
        meta: {
          id: "skill-db",
          name: "DB Skill",
          version: "2.0.0",
          description: "Stored in the database",
        },
        provenance: {
          source: "managed-extension",
          path: "db://runtime-packages/skill/skill-db",
        },
      },
    ]);

    expect(prompt).toContain("DB Skill (skill-db@2.0.0)");
    expect(prompt).toContain("file=db://runtime-packages/skill/skill-db");
    expect(prompt).toContain("Escalate approval requests before running deploy actions.");
  });

  it("omits risk and confirmation metadata from tool summaries", () => {
    const prompt = formatToolPrompt([
      {
        id: "bash",
        description: "Execute shell commands on the local machine.",
        effect: "state_changing",
        keywords: [],
      },
    ]);

    expect(prompt).toContain("Treat each tool schema as authoritative");
    expect(prompt).toContain("- bash: Execute shell commands on the local machine.");
    expect(prompt).not.toContain("risk=");
    expect(prompt).not.toContain("confirmation=");
  });

  it("renders prompt guidance and examples for tools", () => {
    const prompt = formatToolPrompt([
      {
        id: "bash",
        description: "Execute shell commands on the local machine.",
        effect: "state_changing",
        keywords: [],
        promptGuidance: ["Prefer one bounded command at a time."],
        promptExamples: ['{"command":"pnpm lint","cwd":"packages/gateway","timeout_ms":120000}'],
      },
      {
        id: "tool.desktop.snapshot",
        description: "Collect a desktop accessibility snapshot.",
        effect: "read_only",
        keywords: [],
        promptGuidance: ["Use node_id when you need to target a specific desktop node."],
        promptExamples: ['{"include_tree":false,"node_id":"node_123"}'],
      },
    ]);

    expect(prompt).toContain("Guidance: Prefer one bounded command at a time.");
    expect(prompt).toContain('Example: {"command":"pnpm lint"');
    expect(prompt).toContain(
      "Guidance: Use node_id when you need to target a specific desktop node.",
    );
    expect(prompt).toContain('Example: {"include_tree":false,"node_id":"node_123"}');
  });
});

describe("formatIdentityPrompt", () => {
  it("renders tone as style instructions instead of metadata", () => {
    const prompt = formatIdentityPrompt({
      meta: {
        name: "Hypatia",
        style: {
          tone: "Be warm and supportive. Keep answers grounded and easy to follow.",
        },
      },
    } satisfies IdentityPack);

    expect(prompt).toContain("Identity: Hypatia");
    expect(prompt).toContain("Style instructions:");
    expect(prompt).toContain("- Be warm and supportive. Keep answers grounded and easy to follow.");
    expect(prompt).not.toContain("tone=");
  });

  it("expands legacy one-word tones into richer style instructions", () => {
    const prompt = formatIdentityPrompt({
      meta: {
        name: "Hypatia",
        style: {
          tone: "direct",
        },
      },
    } satisfies IdentityPack);

    expect(prompt).toContain("Style instructions:");
    expect(prompt).toContain("Be direct and concise.");
  });
});

function makeTool(id: string): ToolDescriptor {
  return { id, description: `Tool ${id}`, effect: "read_only", keywords: [] };
}

describe("formatMemoryGuidancePrompt", () => {
  it("returns undefined when no memory tools are present", () => {
    const result = formatMemoryGuidancePrompt([makeTool("bash"), makeTool("fs.read")]);
    expect(result).toBeUndefined();
  });

  it("returns write and search guidance when all memory tools are present", () => {
    const tools = [
      makeTool("mcp.memory.seed"),
      makeTool("mcp.memory.search"),
      makeTool("mcp.memory.write"),
    ];
    const result = formatMemoryGuidancePrompt(tools);
    expect(result).toBeDefined();
    expect(result).toContain("Proactively persist durable memory");
    expect(result).toContain("Never write: secrets");
    expect(result).toContain("Search memory when pre-turn recall");
    expect(result).toContain("asks a broad question");
    expect(result).toContain("Do not assume pre-turn recall is complete");
    expect(result).toContain("Pre-turn recall is seed-based");
    expect(result).toContain("If the requested information is not in pre-turn recall");
    expect(result).toContain("run mcp.memory.search before answering");
    expect(result).toContain("search with alternative terms, paraphrases");
  });

  it("adds automation-specific write guidance for triggered work", () => {
    const tools = [
      makeTool("mcp.memory.seed"),
      makeTool("mcp.memory.search"),
      makeTool("mcp.memory.write"),
    ];
    const result = formatMemoryGuidancePrompt(tools, { isAutomationTurn: true });
    expect(result).toContain("For triggered automation work");
    expect(result).toContain("If nothing worth reusing emerged, do not write memory.");
  });

  it("returns only search guidance for read-only profiles without mcp.memory.write", () => {
    const tools = [makeTool("mcp.memory.seed"), makeTool("mcp.memory.search")];
    const result = formatMemoryGuidancePrompt(tools);
    expect(result).toBeDefined();
    expect(result).not.toContain("Proactively persist");
    expect(result).not.toContain("Never write");
    expect(result).toContain("Search memory when pre-turn recall");
    expect(result).toContain("Pre-turn recall is seed-based");
    expect(result).toContain("run mcp.memory.search before answering");
    expect(result).toContain("search with alternative terms, paraphrases");
  });

  it("returns undefined when only seed is present", () => {
    const result = formatMemoryGuidancePrompt([makeTool("mcp.memory.seed")]);
    expect(result).toBeUndefined();
  });

  it("does not mention automation-specific writes when the write tool is unavailable", () => {
    const result = formatMemoryGuidancePrompt(
      [makeTool("mcp.memory.seed"), makeTool("mcp.memory.search")],
      { isAutomationTurn: true },
    );
    expect(result).toBeDefined();
    expect(result).not.toContain("For triggered automation work");
  });
});
