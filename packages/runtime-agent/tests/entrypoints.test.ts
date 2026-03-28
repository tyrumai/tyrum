import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentConfig,
  ContextInjectedFileReport,
  ContextPartReport,
  ContextReport,
  IdentityPack,
  McpServerSpec,
} from "@tyrum/contracts";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AgentContextInjectedFileReport,
  AgentContextPartReport,
  AgentContextPreTurnToolReport,
  AgentContextReport,
  AgentContextToolCallReport,
  AgentLoadedContext,
  AgentRuntimeAssemblyOptions,
} from "../src/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

type LoadedSkillManifest = {
  meta: {
    id: string;
  };
};

describe("@tyrum/runtime-agent entrypoints", () => {
  it("re-exports the runtime orchestrator, lifecycle contracts, and context pruning helpers", async () => {
    const indexSource = await readFile(resolve(__dirname, "../src/index.ts"), "utf8");

    expect(indexSource).toContain("AgentRuntime");
    expect(indexSource).toContain("AgentRuntimeAssemblyOptions");
    expect(indexSource).toContain("AgentLoadedContext");
    expect(indexSource).toContain("AgentContextReport");
    expect(indexSource).toContain("AgentContextPreTurnToolReport");
    expect(indexSource).toContain("AgentContextToolCallReport");
    expect(indexSource).toContain("applyDeterministicContextCompactionAndToolPruning");
  });

  it("exposes package-owned lifecycle contract types", () => {
    expectTypeOf<AgentContextReport>().toEqualTypeOf<ContextReport>();
    expectTypeOf<AgentContextPartReport>().toEqualTypeOf<ContextPartReport>();
    expectTypeOf<AgentContextToolCallReport>().toEqualTypeOf<ContextReport["tool_calls"][number]>();
    expectTypeOf<AgentContextPreTurnToolReport>().toEqualTypeOf<
      ContextReport["pre_turn_tools"][number]
    >();
    expectTypeOf<AgentContextInjectedFileReport>().toEqualTypeOf<ContextInjectedFileReport>();
    expectTypeOf<
      AgentLoadedContext<AgentConfig, IdentityPack, LoadedSkillManifest, McpServerSpec>
    >().toEqualTypeOf<{
      config: AgentConfig;
      identity: IdentityPack;
      skills: LoadedSkillManifest[];
      mcpServers: McpServerSpec[];
    }>();

    const runtimeOptions: AgentRuntimeAssemblyOptions<
      { name: string },
      { scope: string },
      { conversation: string },
      { shutdown(): Promise<void> },
      { id: string },
      { policy: string },
      { provider: string },
      { approval: string },
      { ws: string }
    > = {
      container: { name: "gateway" },
      contextStore: { scope: "tenant:default" },
      conversationDal: { conversation: "conversation-1" },
      mcpManager: {
        shutdown: async () => undefined,
      },
    };

    expect(runtimeOptions.container.name).toBe("gateway");
    expect(runtimeOptions.contextStore.scope).toBe("tenant:default");
    expect(runtimeOptions.conversationDal.conversation).toBe("conversation-1");
  });
});
