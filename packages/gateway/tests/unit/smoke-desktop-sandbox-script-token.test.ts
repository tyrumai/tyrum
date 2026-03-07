import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

test("scripts/smoke-desktop-sandbox provisions and uses GATEWAY_TOKEN directly", () => {
  const scriptUrl = new URL("../../../../scripts/smoke-desktop-sandbox.sh", import.meta.url);
  const script = readFileSync(fileURLToPath(scriptUrl), "utf8");

  expect(script).toMatch(/if \[\[ -z "\$\{GATEWAY_TOKEN:-\}" \]\]; then/);
  expect(script).toMatch(/export GATEWAY_TOKEN="\$\(openssl rand -hex 32\)"/);
  expect(script).toMatch(/const token = process\.env\.GATEWAY_TOKEN\?\.trim\(\);/);
  expect(script).not.toContain('readFileSync("/var/lib/tyrum/.admin-token"');
});
