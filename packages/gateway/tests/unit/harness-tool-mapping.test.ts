import { describe, expect, it } from "vitest";
import { BUILTIN_TOOL_REGISTRY } from "../../src/modules/agent/tool-catalog.js";
import {
  CLAUDE_AGENT_SDK_TOOL_MAP,
  CLAUDE_TOOL_IDS_WITHOUT_SDK_EQUIVALENT,
} from "../../src/modules/harness/claude-agent-sdk/tool-map.js";
import {
  harnessArg,
  mapHarnessToolCall,
  type HarnessToolMap,
} from "../../src/modules/harness/tool-mapping.js";

const TOOL_MAP: HarnessToolMap = {
  Bash: {
    toolId: "bash",
    effect: "state_changing",
    toPolicyArgs: harnessArg.passthrough("command"),
  },
  Read: {
    toolId: "read",
    effect: "read_only",
    toPolicyArgs: harnessArg.path("file_path"),
    pathArg: "file_path",
  },
  Write: {
    toolId: "write",
    effect: "state_changing",
    toPolicyArgs: harnessArg.path("file_path"),
    pathArg: "file_path",
  },
  Grep: {
    toolId: "grep",
    effect: "read_only",
    toPolicyArgs: harnessArg.passthrough("pattern"),
    pathArg: "path",
  },
  WebFetch: {
    toolId: "webfetch",
    effect: "read_only",
    toPolicyArgs: harnessArg.passthrough("url"),
    urlOf: harnessArg.urlFrom("url"),
  },
};

function map(toolName: string, input: Record<string, unknown>, workspaceRoot?: string) {
  return mapHarnessToolCall({
    call: { callId: "call-1", toolName, input },
    toolMap: TOOL_MAP,
    workspaceRoot,
  });
}

describe("mapHarnessToolCall", () => {
  it("canonicalizes a bash command into its policy match target", () => {
    const mapped = map("Bash", { command: "  npm   run   test  " });
    expect(mapped.toolId).toBe("bash");
    expect(mapped.matchTarget).toBe("npm run test");
    expect(mapped.effect).toBe("state_changing");
    expect(mapped.mapped).toBe(true);
  });

  it("rewrites harness argument names onto Tyrum's path-based targets", () => {
    const mapped = map("Read", { file_path: "src/app.ts" }, "/workspace");
    expect(mapped.toolId).toBe("read");
    expect(mapped.matchTarget).toBe("read:src/app.ts");
    expect(mapped.effect).toBe("read_only");
  });

  it("relativizes absolute paths against the workspace root", () => {
    const mapped = map("Write", { file_path: "/workspace/src/out.ts" }, "/workspace");
    expect(mapped.matchTarget).toBe("write:src/out.ts");
  });

  it("reports a path outside the workspace root as an escape", () => {
    const mapped = map("Write", { file_path: "/etc/passwd" }, "/workspace");
    // The match target collapses to the bare prefix, which is indistinguishable
    // from "no path at all" — so the escape has to be reported separately.
    expect(mapped.matchTarget).toBe("write:");
    expect(mapped.pathArgument).toBe("/etc/passwd");
    expect(mapped.escapesWorkspace).toBe(true);
  });

  it("does not report a path inside the workspace root as an escape", () => {
    expect(map("Read", { file_path: "src/app.ts" }, "/workspace").escapesWorkspace).toBe(false);
    expect(map("Read", { file_path: "/workspace/src/app.ts" }, "/workspace").escapesWorkspace).toBe(
      false,
    );
    // Search tools take an optional root of their own.
    expect(map("Grep", { pattern: "PRIVATE KEY", path: "/" }, "/workspace").escapesWorkspace).toBe(
      true,
    );
    expect(map("Grep", { pattern: "TODO" }, "/workspace").escapesWorkspace).toBe(false);
  });

  it("fails closed when there is no workspace root to confine against", () => {
    expect(map("Read", { file_path: "src/app.ts" }).escapesWorkspace).toBe(true);
  });

  it("carries the egress url for network tools", () => {
    const mapped = map("WebFetch", { url: "https://example.com/a?b=1" });
    expect(mapped.toolId).toBe("webfetch");
    expect(mapped.url).toBe("https://example.com/a?b=1");
    expect(mapped.matchTarget).toBe("https://example.com/a");
  });

  it("fails closed for a tool with no mapping entry", () => {
    const mapped = map("WebSearch", { query: "anything" });
    expect(mapped.mapped).toBe(false);
    expect(mapped.effect).toBe("state_changing");
  });

  it("maps MCP tool names onto Tyrum's dotted MCP tool ids and fails closed", () => {
    const mapped = map("mcp__github__get_issue", { number: 1 });
    expect(mapped.toolId).toBe("mcp.github.get_issue");
    expect(mapped.matchTarget).toBe("mcp.github.get_issue");
    // Tyrum cannot know an MCP tool's semantics statically, so it is gated.
    expect(mapped.effect).toBe("state_changing");
    expect(mapped.mapped).toBe(false);
  });
});

describe("CLAUDE_AGENT_SDK_TOOL_MAP coverage", () => {
  it("maps every Tyrum built-in tool the SDK also ships", () => {
    // Policy rules are matched against the *Tyrum* tool id. A built-in missing
    // from the table is evaluated under its harness name instead — a
    // `deny: ["websearch"]` rule would never fire on a `WebSearch` call — so
    // every Tyrum id must be either mapped or explicitly recorded as absent.
    const mappedToolIds = new Set(
      Object.values(CLAUDE_AGENT_SDK_TOOL_MAP).map((entry) => entry.toolId),
    );
    // Scoped to Tyrum's undotted built-ins: the file, shell and web tools a
    // coding-agent harness also ships. Tyrum's dotted orchestration ids
    // (`workboard.*`, `subagent.*`, `memory.*`) have no harness counterpart.
    const uncovered = BUILTIN_TOOL_REGISTRY.map((tool) => tool.id)
      .filter((toolId) => !toolId.includes("."))
      .filter(
        (toolId) =>
          !mappedToolIds.has(toolId) && !CLAUDE_TOOL_IDS_WITHOUT_SDK_EQUIVALENT.includes(toolId),
      );
    expect(uncovered).toEqual([]);
  });

  it("resolves the SDK web-search tool onto Tyrum's tool id", () => {
    const mapped = mapHarnessToolCall({
      call: { callId: "call-1", toolName: "WebSearch", input: { query: "tyrum" } },
      toolMap: CLAUDE_AGENT_SDK_TOOL_MAP,
    });
    // `wildcardMatch("websearch", "WebSearch")` is false, so an unmapped
    // WebSearch would slip a `deny: ["websearch"]` rule entirely.
    expect(mapped.toolId).toBe("websearch");
    expect(mapped.mapped).toBe(true);
  });

  it("declares a path argument for every filesystem tool it maps", () => {
    const filesystemToolIds = new Set(["read", "write", "edit", "glob", "grep"]);
    for (const [toolName, entry] of Object.entries(CLAUDE_AGENT_SDK_TOOL_MAP)) {
      if (!filesystemToolIds.has(entry.toolId)) continue;
      // Without `pathArg` the ask channel cannot confine the call.
      expect(entry.pathArg, `${toolName} must declare its path argument`).toBeDefined();
    }
  });
});
