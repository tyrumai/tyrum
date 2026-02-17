import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MarkdownMemoryStore } from "../../src/modules/agent/markdown-memory.js";

describe("MarkdownMemoryStore", () => {
  let homeDir: string | undefined;

  afterEach(async () => {
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  async function createStore(): Promise<MarkdownMemoryStore> {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-memory-"));
    const store = new MarkdownMemoryStore(homeDir);
    await store.ensureInitialized();
    return store;
  }

  it("creates MEMORY.md and appends daily entries in /memory", async () => {
    const store = await createStore();
    const date = new Date("2026-02-17T12:00:00.000Z");
    await store.appendDaily("User: hello\nAssistant: hi", date);

    const memoryFiles = await readdir(join(homeDir!, "memory"));
    expect(memoryFiles).toContain("MEMORY.md");
    expect(memoryFiles).toContain("2026-02-17.md");

    const dayFile = await readFile(join(homeDir!, "memory/2026-02-17.md"), "utf-8");
    expect(dayFile).toContain("User: hello");
  });

  it("appends to core section without duplicating lines", async () => {
    const store = await createStore();
    await store.appendToCoreSection("Learned Preferences", "- I prefer concise answers.");
    await store.appendToCoreSection("Learned Preferences", "- I prefer concise answers.");
    await store.appendToCoreSection("Learned Preferences", "- Never send emojis.");

    const core = await readFile(join(homeDir!, "memory/MEMORY.md"), "utf-8");
    expect(core.match(/I prefer concise answers/g)?.length).toBe(1);
    expect(core).toContain("Never send emojis.");
  });

  it("searches across core and daily memory files", async () => {
    const store = await createStore();
    await store.appendToCoreSection("Learned Preferences", "- Use timezone America/Chicago.");
    await store.appendDaily("Follow-up: timezone updated.", new Date("2026-02-17T00:00:00.000Z"));

    const hits = await store.search("timezone", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.file === "MEMORY.md")).toBe(true);
  });
});
