import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("scripts/smoke-desktop-sandbox approves pairing with desktop capability allowlist", () => {
  const scriptUrl = new URL("../../../../scripts/smoke-desktop-sandbox.sh", import.meta.url);
  const script = readFileSync(fileURLToPath(scriptUrl), "utf8");

  expect(script).toMatch(/capabilityDescriptorsForClientCapability\("desktop"\)/);
  expect(script).toMatch(/capability_allowlist:\s*desktopCapabilityAllowlist/);
});

test("scripts/smoke-desktop-sandbox cleans up desktop-sandbox profile containers", () => {
  const scriptUrl = new URL("../../../../scripts/smoke-desktop-sandbox.sh", import.meta.url);
  const script = readFileSync(fileURLToPath(scriptUrl), "utf8");

  expect(script).toMatch(/docker compose --profile desktop-sandbox down -v --remove-orphans/);
});
