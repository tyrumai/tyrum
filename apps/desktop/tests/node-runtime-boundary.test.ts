import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const NODE_RUNTIME_PATH = resolve(process.cwd(), "apps/desktop/src/main/node-runtime.ts");

describe("desktop node runtime boundary", () => {
  it("uses @tyrum/node-sdk for generic node client wiring", () => {
    const source = readFileSync(NODE_RUNTIME_PATH, "utf8");

    expect(source).toContain('from "@tyrum/node-sdk/node"');
    expect(source).not.toContain('from "@tyrum/transport-sdk/node"');
  });
});
