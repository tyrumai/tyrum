import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_JSON_PATH = resolve(process.cwd(), "packages/desktop-node/package.json");

describe("@tyrum/desktop-node package boundary", () => {
  it("does not declare a direct transport-sdk dependency", () => {
    const manifest = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      dependencies?: Record<string, string>;
    };

    expect(manifest.dependencies).not.toHaveProperty("@tyrum/transport-sdk");
  });
});
