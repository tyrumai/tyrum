import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("agent runtime lifecycle contract extraction", () => {
  it("sources gateway runtime lifecycle contracts from @tyrum/runtime-agent", async () => {
    const typesPath = join(__dirname, "../../src/modules/agent/runtime/types.ts");
    const raw = await readFile(typesPath, "utf-8");

    expect(raw).toContain('from "@tyrum/runtime-agent"');
    expect(raw).not.toMatch(/\bexport interface AgentRuntimeOptions\b/);
    expect(raw).not.toMatch(/\bexport interface AgentLoadedContext\b/);
    expect(raw).not.toMatch(/\bexport interface AgentContextPartReport\b/);
    expect(raw).not.toMatch(/\bexport interface AgentContextToolCallReport\b/);
    expect(raw).not.toMatch(/\bexport interface AgentContextPreTurnToolReport\b/);
    expect(raw).not.toMatch(/\bexport interface AgentContextInjectedFileReport\b/);
    expect(raw).not.toMatch(/\bexport interface AgentContextReport\b/);
  });
});
