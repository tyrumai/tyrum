import { DEFAULT_PERSONA_TONE_INSTRUCTIONS, type IdentityPack } from "@tyrum/contracts";
import { describe, expect, it } from "vitest";
import {
  formatIdentityPrompt,
  formatMemoryGuidancePrompt,
  formatSkillsPrompt,
  formatToolPrompt,
  formatWorkOrchestrationPrompt,
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

  it("uses the default persona tone instructions when tone is blank", () => {
    const prompt = formatIdentityPrompt({
      meta: {
        name: "Hypatia",
        style: {
          tone: "   ",
        },
      },
    } satisfies IdentityPack);

    const defaultInstruction = DEFAULT_PERSONA_TONE_INSTRUCTIONS.split(/\n+/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    expect(defaultInstruction).toBeDefined();
    if (!defaultInstruction) {
      throw new Error("Expected default persona tone instructions to include at least one line.");
    }
    expect(prompt).toContain("Style instructions:");
    expect(prompt).toContain(defaultInstruction);
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
    const tools = [makeTool("memory.seed"), makeTool("memory.search"), makeTool("memory.write")];
    const result = formatMemoryGuidancePrompt(tools);
    expect(result).toBeDefined();
    expect(result).toContain("Proactively persist durable memory");
    expect(result).toContain("Never write: secrets");
    expect(result).toContain("Search memory when pre-turn recall");
    expect(result).toContain("asks a broad question");
    expect(result).toContain("Do not assume pre-turn recall is complete");
    expect(result).toContain("Pre-turn recall is seed-based");
    expect(result).toContain("If the requested information is not in pre-turn recall");
    expect(result).toContain("run memory.search before answering");
    expect(result).toContain("stored profile details such as addresses");
    expect(result).toContain("search memory before asking the user to repeat them");
    expect(result).toContain("When memory contains an exact answer");
    expect(result).toContain("Do not replace it with a guess");
    expect(result).toContain("search with alternative terms, paraphrases");
  });

  it("adds automation-specific write guidance for triggered work", () => {
    const tools = [makeTool("memory.seed"), makeTool("memory.search"), makeTool("memory.write")];
    const result = formatMemoryGuidancePrompt(tools, { isAutomationTurn: true });
    expect(result).toContain("For triggered automation work");
    expect(result).toContain("If nothing worth reusing emerged, do not write memory.");
    expect(result).toContain("call memory.write only when the work yields");
  });

  it("returns only search guidance for read-only profiles without mcp.memory.write", () => {
    const tools = [makeTool("mcp.memory.seed"), makeTool("mcp.memory.search")];
    const result = formatMemoryGuidancePrompt(tools);
    expect(result).toBeDefined();
    expect(result).not.toContain("Proactively persist");
    expect(result).not.toContain("Never write");
    expect(result).toContain("Search memory when pre-turn recall");
    expect(result).toContain("Pre-turn recall is seed-based");
    expect(result).toContain("run memory.search before answering");
    expect(result).toContain("stored profile details such as addresses");
    expect(result).toContain("When memory contains an exact answer");
    expect(result).toContain("search with alternative terms, paraphrases");
  });

  it("returns undefined when only seed is present", () => {
    const result = formatMemoryGuidancePrompt([makeTool("memory.seed")]);
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

describe("formatWorkOrchestrationPrompt", () => {
  it("returns undefined when no high-level orchestration tools are exposed", () => {
    expect(formatWorkOrchestrationPrompt([makeTool("workboard.item.list")])).toBeUndefined();
  });

  it("guides the model toward exposed high-level orchestration tools only", () => {
    const result = formatWorkOrchestrationPrompt([
      makeTool("workboard.capture"),
      makeTool("workboard.clarification.request"),
      makeTool("subagent.spawn"),
      makeTool("workboard.item.list"),
    ]);

    expect(result).toContain("Runtime-managed WorkBoard bookkeeping already handles");
    expect(result).toContain("Use workboard.clarification.request only when progress is blocked");
    expect(result).toContain("Capture multi-step or durable work with workboard.capture");
    expect(result).toContain("Use subagent.spawn only for bounded helper work");
    expect(result).not.toContain("inspect durable current state");
  });
});
