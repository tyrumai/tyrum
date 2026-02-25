import { describe, expect, it } from "vitest";
import { ContextReport } from "../src/index.js";

describe("ContextReport", () => {
  it("parses a full context report payload", () => {
    const parsed = ContextReport.parse({
      context_report_id: "123e4567-e89b-12d3-a456-426614174000",
      generated_at: "2026-02-23T00:00:00.000Z",
      session_id: "telegram:dm-1",
      channel: "telegram",
      thread_id: "dm-1",
      agent_id: "default",
      workspace_id: "default",
      system_prompt: {
        chars: 10,
        sections: [
          { id: "identity", chars: 5 },
          { id: "safety", chars: 5 },
        ],
      },
      user_parts: [{ id: "message", chars: 5 }],
      selected_tools: ["tool.fs.read"],
      tool_schema_top: [{ id: "tool.fs.read", chars: 50 }],
      tool_schema_total_chars: 50,
      enabled_skills: [],
      mcp_servers: [],
      memory: { keyword_hits: 0, semantic_hits: 0 },
      tool_calls: [{ tool_call_id: "tc-1", tool_id: "tool.fs.read", injected_chars: 100 }],
      injected_files: [
        {
          tool_call_id: "tc-1",
          path: "big.txt",
          raw_chars: 40_000,
          selected_chars: 40_000,
          injected_chars: 32_800,
          truncated: true,
          truncation_marker: "...(truncated)",
        },
      ],
    });

    expect(parsed.system_prompt.sections.length).toBe(2);
    expect(parsed.tool_schema_total_chars).toBe(50);
    expect(parsed.injected_files[0]?.truncated).toBe(true);
  });

  it("accepts legacy reports missing newer fields", () => {
    const parsed = ContextReport.parse({
      context_report_id: "123e4567-e89b-12d3-a456-426614174000",
      generated_at: "2026-02-23T00:00:00.000Z",
      session_id: "telegram:dm-1",
      channel: "telegram",
      thread_id: "dm-1",
      agent_id: "default",
      workspace_id: "default",
      system_prompt: { chars: 10 },
      user_parts: [{ id: "message", chars: 5 }],
      selected_tools: ["tool.fs.read"],
      tool_schema_top: [{ id: "tool.fs.read", chars: 50 }],
      enabled_skills: [],
      mcp_servers: [],
      memory: { keyword_hits: 0, semantic_hits: 0 },
    });

    expect(parsed.system_prompt.sections).toEqual([]);
    expect(parsed.tool_schema_total_chars).toBe(0);
    expect(parsed.tool_calls).toEqual([]);
    expect(parsed.injected_files).toEqual([]);
  });

  it("preserves unknown keys for forward compatibility", () => {
    const parsed = ContextReport.parse({
      context_report_id: "123e4567-e89b-12d3-a456-426614174000",
      generated_at: "2026-02-23T00:00:00.000Z",
      session_id: "telegram:dm-1",
      channel: "telegram",
      thread_id: "dm-1",
      agent_id: "default",
      workspace_id: "default",
      system_prompt: { chars: 10, extra_system_field: "keep-me" },
      user_parts: [{ id: "message", chars: 5 }],
      selected_tools: [],
      tool_schema_top: [],
      enabled_skills: [],
      mcp_servers: [],
      memory: { keyword_hits: 0, semantic_hits: 0, extra_memory_field: "keep-me" },
      extra_root_field: { nested: true },
    });

    expect((parsed as Record<string, unknown>)["extra_root_field"]).toEqual({ nested: true });
    expect((parsed.system_prompt as unknown as Record<string, unknown>)["extra_system_field"]).toBe(
      "keep-me",
    );
    expect((parsed.memory as unknown as Record<string, unknown>)["extra_memory_field"]).toBe(
      "keep-me",
    );
  });
});
