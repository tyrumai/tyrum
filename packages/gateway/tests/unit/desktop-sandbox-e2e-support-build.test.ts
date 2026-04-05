import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

function readSupportFile(): string {
  const supportUrl = new URL("../integration/desktop-sandbox-e2e-support.ts", import.meta.url);
  return readFileSync(fileURLToPath(supportUrl), "utf8");
}

describe("desktop sandbox e2e support image build", () => {
  test("loads rebuilt images into the local daemon", () => {
    const supportFile = readSupportFile();
    expect(supportFile).toContain(
      '["build", "--load", "-f", "docker/desktop-sandbox/Dockerfile", "-t", imageTag, "."]',
    );
  });
});
