import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("main theme IPC registration", () => {
  it("registers theme IPC using the local BrowserWindow instance", () => {
    const source = readFileSync(join(import.meta.dirname, "../src/main/index.ts"), "utf-8");

    expect(source).toMatch(/\bregisterThemeIpc\(window\);/);
    expect(source).not.toMatch(/\bregisterThemeIpc\(mainWindow\);/);
  });
});

