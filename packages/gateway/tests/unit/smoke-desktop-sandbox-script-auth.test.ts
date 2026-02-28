import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("scripts/smoke-desktop-sandbox sends auth headers when listing pending pairings", () => {
  const scriptUrl = new URL("../../../../scripts/smoke-desktop-sandbox.sh", import.meta.url);
  const script = readFileSync(fileURLToPath(scriptUrl), "utf8");

  expect(script).toMatch(
    /fetchJson\(\s*["']\/pairings\?status=pending["']\s*,\s*\{\s*headers\s*\}\s*\)/,
  );
});
