import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

describe("Issue #842 API reference docs", () => {
  it("adds docs/api-reference.md covering HTTP and WebSocket APIs", async () => {
    const doc = await readFile(resolve(repoRoot, "docs/api-reference.md"), "utf8");

    expect(doc).toMatch(/^# API Reference$/m);
    expect(doc).toMatch(/^## Table of Contents$/m);
    expect(doc).toMatch(/^## HTTP API$/m);
    expect(doc).toMatch(/^## WebSocket API$/m);

    const httpEndpointHeadings = doc.match(/^#### (GET|POST|PUT|PATCH|DELETE) [/]\S+/gm) ?? [];
    expect(httpEndpointHeadings.length).toBeGreaterThanOrEqual(20);

    const wsMessageHeadings = doc.match(/^#### `[^`]+`$/gm) ?? [];
    expect(wsMessageHeadings.length).toBeGreaterThanOrEqual(15);

    expect(doc).toMatch(/future automation/i);
  });
});
