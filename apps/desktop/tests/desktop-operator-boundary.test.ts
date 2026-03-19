import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DESKTOP_OPERATOR_CORE_PATH = resolve(
  process.cwd(),
  "apps/desktop/src/renderer/lib/desktop-operator-core.ts",
);

describe("desktop operator renderer boundary", () => {
  it("uses @tyrum/operator-app browser helpers instead of transport-sdk directly", () => {
    const source = readFileSync(DESKTOP_OPERATOR_CORE_PATH, "utf8");

    expect(source).toContain('from "@tyrum/operator-app/browser"');
    expect(source).not.toContain('from "@tyrum/transport-sdk/browser"');
  });
});
