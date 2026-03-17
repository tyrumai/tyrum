import { describe, expect, it } from "vitest";
import { formatSkillsPrompt, formatToolPrompt } from "../../src/modules/agent/runtime/prompts.js";

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

  it("renders prompt guidance and examples for risky tools", () => {
    const prompt = formatToolPrompt([
      {
        id: "tool.node.dispatch",
        description: "Dispatch a specific capability action to a connected node.",
        effect: "state_changing",
        keywords: [],
        promptGuidance: [
          "Put action-specific arguments inside the input object.",
          "Do not add the transport op field yourself.",
        ],
        promptExamples: [
          '{"node_id":"node_123","capability":"tyrum.desktop.screenshot","action_name":"screenshot","input":{"display":"all"}}',
        ],
      },
    ]);

    expect(prompt).toContain("Guidance: Put action-specific arguments inside the input object.");
    expect(prompt).toContain('Example: {"node_id":"node_123"');
    expect(prompt).toContain('"input":{"display":"all"}');
  });
});
