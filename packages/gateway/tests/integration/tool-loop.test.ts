import { afterEach, describe, expect, it, vi } from "vitest";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import type { ApprovalRow } from "../../src/modules/approval/dal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations");

/**
 * Creates a fetch stub that simulates an LLM server.
 * On the first LLM call, returns tool_calls. On subsequent LLM calls, returns final text.
 * Non-LLM calls (e.g. embedding endpoint) return a 404 so they are handled gracefully.
 */
function resolveFetchUrl(urlOrInput: string | URL | Request): string {
  if (typeof urlOrInput === "string") return urlOrInput;
  if (urlOrInput instanceof URL) return urlOrInput.toString();
  const maybeRequest = urlOrInput as unknown as { url?: string };
  if (typeof maybeRequest.url === "string") return maybeRequest.url;
  return String(urlOrInput);
}

function createToolCallFetchStub(
  toolCalls: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>,
  finalReply: string,
): typeof fetch {
  let llmCallCount = 0;
  return (async (urlOrInput: string | URL | Request, _init?: RequestInit) => {
    const url = resolveFetchUrl(urlOrInput);

    // Only count LLM chat/completions calls
    if (!url.includes("/chat/completions")) {
      return new Response("not found", { status: 404 });
    }

    llmCallCount++;
    if (llmCallCount === 1) {
      // First LLM call: return tool_calls
      return new Response(
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
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // Subsequent LLM calls: return final text
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: finalReply } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

function createSimpleFetchStub(reply: string): typeof fetch {
  return (async (urlOrInput: string | URL | Request, _init?: RequestInit) => {
    const url = resolveFetchUrl(urlOrInput);

    if (!url.includes("/chat/completions")) {
      return new Response("not found", { status: 404 });
    }

    return new Response(
      JSON.stringify({ choices: [{ message: { content: reply } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

async function waitForPendingApproval(
  container: GatewayContainer,
  timeoutMs = 5_000,
): Promise<ApprovalRow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pending = container.approvalDal.getPending();
    if (pending.length > 0) {
      return pending[0]!;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for pending approval");
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

  it("queues high-risk tool calls and resumes after approval", async () => {
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

    const fetchStub = createToolCallFetchStub(
      [
        {
          id: "tc-approve",
          function: {
            name: "tool.exec",
            arguments: JSON.stringify({ command: "echo approved" }),
          },
        },
      ],
      "approved and executed",
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
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-approval-1",
      message: "run command",
    });

    const pending = await waitForPendingApproval(container);
    expect(pending.prompt).toContain("tool.exec");
    expect(pending.status).toBe("pending");

    const updated = container.approvalDal.respond(
      pending.id,
      true,
      "approved in test",
    );
    expect(updated?.status).toBe("approved");

    const result = await turnPromise;
    expect(result.reply).toBe("approved and executed");
    expect(result.used_tools).toContain("tool.exec");
  });

  it("does not execute high-risk tool when approval is denied", async () => {
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
        "    - tool.fs.write",
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
          id: "tc-deny",
          function: {
            name: "tool.fs.write",
            arguments: JSON.stringify({ path: "blocked.txt", content: "secret" }),
          },
        },
      ],
      "approval denied",
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
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-approval-2",
      message: "write blocked file",
    });

    const pending = await waitForPendingApproval(container);
    const updated = container.approvalDal.respond(
      pending.id,
      false,
      "denied in test",
    );
    expect(updated?.status).toBe("denied");

    const result = await turnPromise;
    expect(result.reply).toBe("approval denied");
    expect(result.used_tools).not.toContain("tool.fs.write");
    await expect(access(join(homeDir, "blocked.txt"))).rejects.toThrow();
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
      const url = resolveFetchUrl(urlOrInput);

      // Non-LLM, non-tool calls (e.g. embeddings) — return 404 so they fail gracefully
      if (!url.includes("/chat/completions") && !url.startsWith("https://")) {
        return new Response("not found", { status: 404 });
      }

      // LLM calls go to completions endpoint
      if (url.includes("/chat/completions")) {
        llmCallIndex++;
        if (llmCallIndex === 1) {
          return new Response(
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
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "done with both tools" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      // Tool http.fetch call
      return new Response("example.com content", { status: 200 });
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
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const autoApproveTimer = setInterval(() => {
      for (const approval of container!.approvalDal.getPending()) {
        container!.approvalDal.respond(approval.id, true, "approved in test");
      }
    }, 20);
    autoApproveTimer.unref();

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-3",
      message: "read a file and fetch a url",
    });
    clearInterval(autoApproveTimer);

    expect(result.reply).toBe("done with both tools");
    expect(result.used_tools).toContain("tool.fs.read");
    expect(result.used_tools).toContain("tool.http.fetch");
    expect(result.used_tools).toHaveLength(2);
  });

  it("respects maxSteps and stops looping", async () => {
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
    const infiniteFetch = (async (urlOrInput: string | URL | Request, _init?: RequestInit) => {
      const url = resolveFetchUrl(urlOrInput);

      if (!url.includes("/chat/completions")) {
        return new Response("not found", { status: 404 });
      }

      return new Response(
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
        { status: 200, headers: { "content-type": "application/json" } },
      );
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
      maxSteps: 3,
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const autoApproveTimer = setInterval(() => {
      for (const approval of container!.approvalDal.getPending()) {
        container!.approvalDal.respond(approval.id, true, "approved in test");
      }
    }, 20);
    autoApproveTimer.unref();

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-4",
      message: "run something",
    });
    clearInterval(autoApproveTimer);

    // Should stop after maxSteps and return the default "No assistant response"
    expect(result.reply).toBe("No assistant response returned.");
    expect(result.used_tools).toContain("tool.exec");
  });
});
