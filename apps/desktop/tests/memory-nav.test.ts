import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Memory inspector navigation wiring", () => {
  it("routes the memory page id in the app shell", () => {
    const app = readFileSync(join(import.meta.dirname, "../src/renderer/App.tsx"), "utf-8");

    expect(app).toContain('"memory"');
    expect(app).toContain("<MemoryPage");
  });

  it("imports MemoryPage from operator-ui", () => {
    const app = readFileSync(join(import.meta.dirname, "../src/renderer/App.tsx"), "utf-8");
    expect(app).toContain("MemoryPage");
    expect(app).toContain("@tyrum/operator-ui");
  });
});
