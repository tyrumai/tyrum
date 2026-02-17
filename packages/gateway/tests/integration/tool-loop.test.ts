import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations");

/**
 * Creates a fetch stub that simulates an LLM server.
 * On the first LLM call, returns tool_calls. On subsequent LLM calls, returns final text.
 * Non-LLM calls (e.g. embedding endpoint) return a 404 so they are handled gracefully.
 */
function createToolCallFetchStub(
  toolCalls: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>,
  finalReply: string,
): typeof fetch {
  let llmCallCount = 0;
  return (async (urlOrInput: string | URL | Request) => {
    const url = typeof urlOrInput === "string" ? urlOrInput : urlOrInput.toString();

    // Only count LLM chat/completions calls
    if (!url.includes("/chat/completions")) {
      return { ok: false, status: 404, text: async () => "not found" } as unknown as Response;
    }

    llmCallCount++;
    if (llmCallCount === 1) {
      // First LLM call: return tool_calls
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: toolCalls.map((tc) => ({
                    id: tc.id,
                    type: "function",
                    function: tc.function,
                  })),
                },
              },
            ],
          }),
      } as unknown as Response;
    }
    // Subsequent LLM calls: return final text
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: finalReply } }],
        }),
    } as unknown as Response;
  }) as typeof fetch;
}

function createSimpleFetchStub(reply: string): typeof fetch {
  return (async (urlOrInput: string | URL | Request) => {
    const url = typeof urlOrInput === "string" ? urlOrInput : urlOrInput.toString();

    if (!url.includes("/chat/completions")) {
      return { ok: false, status: 404, text: async () => "not found" } as unknown as Response;
    }

    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: reply } }] }),
    } as unknown as Response;
  }) as typeof fetch;
}

describe("Tool execution loop", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("executes tool calls and returns the final reply", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-tool-loop-"));
    container = createContainer({ dbPath: ":memory:", migrationsDir });

    // Create a file for tool.fs.read to read
    await writeFile(join(homeDir, "notes.txt"), "important notes", "utf-8");

    // Write agent config that allows tool.fs.read
    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: test-model",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow:",
        "    - tool.fs.read",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    const fetchStub = createToolCallFetchStub(
      [
        {
          id: "tc-1",
          function: {
            name: "tool.fs.read",
            arguments: JSON.stringify({ path: "notes.txt" }),
          },
        },
      ],
      "I read the file, it says: important notes",
    );

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      fetchImpl: fetchStub,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "read the notes file",
    });

    expect(result.reply).toBe("I read the file, it says: important notes");
    expect(result.used_tools).toContain("tool.fs.read");
  });

  it("returns final reply when LLM returns no tool_calls (single-shot)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-tool-loop-"));
    container = createContainer({ dbPath: ":memory:", migrationsDir });

    const fetchStub = createSimpleFetchStub("just a reply");

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      fetchImpl: fetchStub,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-2",
      message: "hello",
    });

    expect(result.reply).toBe("just a reply");
    expect(result.used_tools).toEqual([]);
  });

  it("populates used_tools across multiple tool calls", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-tool-loop-"));
    container = createContainer({ dbPath: ":memory:", migrationsDir });

    await writeFile(join(homeDir, "a.txt"), "file A", "utf-8");

    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: test-model",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow:",
        "    - tool.fs.read",
        "    - tool.http.fetch",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    // LLM returns two tool_calls in one response
    createToolCallFetchStub(
      [
        {
          id: "tc-1",
          function: {
            name: "tool.fs.read",
            arguments: JSON.stringify({ path: "a.txt" }),
          },
        },
        {
          id: "tc-2",
          function: {
            name: "tool.http.fetch",
            arguments: JSON.stringify({ url: "https://example.com" }),
          },
        },
      ],
      "done with both tools",
    );

    // The fetchStub will be used for both the LLM call AND the http.fetch tool call.
    // The ToolExecutor uses the same fetchImpl, so we need a smarter mock.
    let llmCallIndex = 0;
    const smartFetch = (async (urlOrInput: string | URL | Request, _init?: RequestInit) => {
      const url = typeof urlOrInput === "string" ? urlOrInput : urlOrInput.toString();

      // Non-LLM, non-tool calls (e.g. embeddings) — return 404 so they fail gracefully
      if (!url.includes("/chat/completions") && !url.startsWith("https://")) {
        return { ok: false, status: 404, text: async () => "not found" } as unknown as Response;
      }

      // LLM calls go to completions endpoint
      if (url.includes("/v1/chat/completions")) {
        llmCallIndex++;
        if (llmCallIndex === 1) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: null,
                      tool_calls: [
                        {
                          id: "tc-1",
                          type: "function",
                          function: {
                            name: "tool.fs.read",
                            arguments: JSON.stringify({ path: "a.txt" }),
                          },
                        },
                        {
                          id: "tc-2",
                          type: "function",
                          function: {
                            name: "tool.http.fetch",
                            arguments: JSON.stringify({ url: "https://example.com" }),
                          },
                        },
                      ],
                    },
                  },
                ],
              }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              choices: [{ message: { content: "done with both tools" } }],
            }),
        } as unknown as Response;
      }

      // Tool http.fetch call
      return {
        ok: true,
        status: 200,
        text: async () => "example.com content",
      } as unknown as Response;
    }) as typeof fetch;

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      fetchImpl: smartFetch,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-3",
      message: "read a file and fetch a url",
    });

    expect(result.reply).toBe("done with both tools");
    expect(result.used_tools).toContain("tool.fs.read");
    expect(result.used_tools).toContain("tool.http.fetch");
    expect(result.used_tools).toHaveLength(2);
  });

  it("respects maxIterations and stops looping", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-tool-loop-"));
    container = createContainer({ dbPath: ":memory:", migrationsDir });

    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: test-model",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow:",
        "    - tool.exec",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    // Always return tool_calls for LLM calls, never final text
    const infiniteFetch = (async (urlOrInput: string | URL | Request) => {
      const url = typeof urlOrInput === "string" ? urlOrInput : urlOrInput.toString();

      if (!url.includes("/chat/completions")) {
        return { ok: false, status: 404, text: async () => "not found" } as unknown as Response;
      }

      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "tc-loop",
                      type: "function",
                      function: {
                        name: "tool.exec",
                        arguments: JSON.stringify({ command: "echo hi" }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
      } as unknown as Response;
    }) as typeof fetch;

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      fetchImpl: infiniteFetch,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
      maxIterations: 3,
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-4",
      message: "run something",
    });

    // Should stop after maxIterations and return the default "No assistant response"
    expect(result.reply).toBe("No assistant response returned.");
    expect(result.used_tools).toContain("tool.exec");
  });
});
