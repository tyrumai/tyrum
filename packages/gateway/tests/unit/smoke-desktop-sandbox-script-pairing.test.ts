import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("scripts/smoke-desktop-sandbox approves pairing with desktop capability allowlist", () => {
  const scriptUrl = new URL("../../../../scripts/smoke-desktop-sandbox.sh", import.meta.url);
  const script = readFileSync(fileURLToPath(scriptUrl), "utf8");

  expect(script).toMatch(/descriptorIdForClientCapability\("desktop"\)/);
  expect(script).toMatch(/CAPABILITY_DESCRIPTOR_DEFAULT_VERSION/);
  expect(script).toMatch(
    /capability_allowlist:\s*\[\s*\{\s*id:\s*desktopDescriptorId,\s*version:\s*CAPABILITY_DESCRIPTOR_DEFAULT_VERSION\s*\}\s*,?\s*\]/,
  );
});

test("scripts/smoke-desktop-sandbox cleans up desktop-sandbox profile containers", () => {
  const scriptUrl = new URL("../../../../scripts/smoke-desktop-sandbox.sh", import.meta.url);
  const script = readFileSync(fileURLToPath(scriptUrl), "utf8");

  expect(script).toMatch(/docker compose --profile desktop-sandbox down -v --remove-orphans/);
});
