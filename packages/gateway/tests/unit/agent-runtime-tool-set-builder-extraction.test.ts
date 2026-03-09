import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import {
  createToolSetBuilder,
  makeContextReport,
  setupTestEnv,
  teardownTestEnv,
} from "./agent-runtime.test-helpers.js";
import { createStubLanguageModel } from "./stub-language-model.js";

describe("ToolSetBuilder webfetch extraction", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("runs a model extraction pass for webfetch(mode=extract)", async () => {
    ({ homeDir, container } = await setupTestEnv());

    const toolSetBuilder = createToolSetBuilder({
      home: homeDir,
      container,
      policyService: {
        isEnabled: () => false,
        isObserveOnly: () => false,
      },
    });

    const toolExecutor = {
      execute: vi.fn(async () => ({
        tool_call_id: "tc-webfetch-1",
        output: '<data source="web">\nraw crawl body\n</data>',
        provenance: {
          content: "raw crawl body",
          source: "web" as const,
          trusted: false,
        },
      })),
    };

    const toolSet = toolSetBuilder.buildToolSet(
      [
        {
          id: "webfetch",
          description: "Fetch web content",
          risk: "medium",
          requires_confirmation: false,
          keywords: [],
          inputSchema: { type: "object", additionalProperties: true },
        },
      ],
      toolExecutor as never,
      new Set<string>(),
      {
        planId: "plan-1",
        sessionId: "session-1",
        channel: "test",
        threadId: "thread-1",
      },
      makeContextReport() as never,
      undefined,
      undefined,
      createStubLanguageModel("## Extracted\n- grounded summary"),
    );

    const result = await toolSet["webfetch"]!.execute({
      url: "https://example.com",
      mode: "extract",
      prompt: "Summarize the page",
    });

    expect(String(result)).toContain("grounded summary");
    expect(String(result)).toContain('<data source="web">');
    expect(String(result)).not.toContain("raw crawl body");
  });

  it("keeps raw crawl output when webfetch is not in extract mode", async () => {
    ({ homeDir, container } = await setupTestEnv());

    const toolSetBuilder = createToolSetBuilder({
      home: homeDir,
      container,
      policyService: {
        isEnabled: () => false,
        isObserveOnly: () => false,
      },
    });

    const toolExecutor = {
      execute: vi.fn(async () => ({
        tool_call_id: "tc-webfetch-2",
        output: '<data source="web">\nraw crawl body\n</data>',
        provenance: {
          content: "raw crawl body",
          source: "web" as const,
          trusted: false,
        },
      })),
    };

    const toolSet = toolSetBuilder.buildToolSet(
      [
        {
          id: "webfetch",
          description: "Fetch web content",
          risk: "medium",
          requires_confirmation: false,
          keywords: [],
          inputSchema: { type: "object", additionalProperties: true },
        },
      ],
      toolExecutor as never,
      new Set<string>(),
      {
        planId: "plan-1",
        sessionId: "session-1",
        channel: "test",
        threadId: "thread-1",
      },
      makeContextReport() as never,
      undefined,
      undefined,
      createStubLanguageModel("should not be used"),
    );

    const result = await toolSet["webfetch"]!.execute({
      url: "https://example.com",
      mode: "raw",
    });

    expect(String(result)).toContain("raw crawl body");
  });
});
