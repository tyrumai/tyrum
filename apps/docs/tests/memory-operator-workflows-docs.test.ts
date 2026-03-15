import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listMarkdownFiles } from "./markdown-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

describe("Memory architecture docs (Issue #666)", () => {
  it("documents MCP-native memory prompt seeding and in-turn tools", async () => {
    const memoryDoc = await readFile(
      resolve(repoRoot, "docs/architecture/agent/memory/index.md"),
      "utf8",
    );

    expect(memoryDoc).toMatch(/MCP-native capability/i);
    expect(memoryDoc).toMatch(/mcp\.memory\.seed\b/);
    expect(memoryDoc).toMatch(/mcp\.memory\.search\b/);
    expect(memoryDoc).toMatch(/mcp\.memory\.write\b/);
    expect(memoryDoc).toMatch(/pre_turn_tools/i);
    expect(memoryDoc).toMatch(/server_settings\.memory/i);
    expect(memoryDoc).toMatch(/tombstone/i);
  });

  it("does not document legacy Memory v1 operator APIs", async () => {
    const mdFiles = await listMarkdownFiles(resolve(repoRoot, "docs"));
    const legacyEndpointPattern =
      /(^|[^.\w])(memory\.(list|search|get|create|update|delete|forget|export)|\/memory\/exports\/:id)\b/i;

    for (const file of mdFiles) {
      const content = await readFile(file, "utf8");
      expect(content).not.toMatch(legacyEndpointPattern);
    }
  });
});
