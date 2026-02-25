import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("scripts/format-changed uses pnpm.cmd on win32", () => {
  const scriptUrl = new URL("../../../../scripts/format-changed.mjs", import.meta.url);
  const script = readFileSync(fileURLToPath(scriptUrl), "utf8");

  expect(script).toContain("pnpm.cmd");
  expect(script).toContain("win32");
});
