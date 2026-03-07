import { describe, expect, it, vi } from "vitest";
import { SharedMarkdownMemoryStore } from "../../src/modules/agent/shared-markdown-memory-store.js";

describe("SharedMarkdownMemoryStore", () => {
  it("appends daily entries through the DAL append path", async () => {
    const ensureCoreDoc = vi.fn(async () => ({
      tenantId: "tenant-1",
      agentId: "agent-1",
      docKind: "core" as const,
      docKey: "MEMORY",
      content: "# MEMORY\n",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const appendDoc = vi.fn(async () => ({
      tenantId: "tenant-1",
      agentId: "agent-1",
      docKind: "daily" as const,
      docKey: "2026-02-17",
      content: "\n## 2026-02-17T12:00:00.000Z\nUser: hello\n",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    const store = new SharedMarkdownMemoryStore(
      {
        ensureCoreDoc,
        appendDoc,
        getDoc: vi.fn(() => {
          throw new Error("appendDaily should not read-modify-write daily docs");
        }),
        putDoc: vi.fn(() => {
          throw new Error("appendDaily should not overwrite daily docs");
        }),
        listDocs: vi.fn(async () => []),
      } as never,
      { tenantId: "tenant-1", agentId: "agent-1" },
    );

    const uri = await store.appendDaily("User: hello", new Date("2026-02-17T12:00:00.000Z"));

    expect(uri).toBe("db://markdown-memory/tenant-1/agent-1/daily/2026-02-17");
    expect(ensureCoreDoc).toHaveBeenCalledWith({ tenantId: "tenant-1", agentId: "agent-1" });
    expect(appendDoc).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      agentId: "agent-1",
      docKind: "daily",
      docKey: "2026-02-17",
      suffix: "\n## 2026-02-17T12:00:00.000Z\nUser: hello\n",
    });
  });
});
