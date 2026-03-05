import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

describe("integration helpers", () => {
  const createdHomes: string[] = [];

  afterAll(() => {
    for (const home of createdHomes) {
      expect(existsSync(home)).toBe(false);
    }
  });

  it("does not create/use $HOME/.tyrum when TYRUM_HOME is unset", async () => {
    const isolatedHome = await mkdtemp(join(tmpdir(), "tyrum-integration-home-"));
    const priorHome = process.env["HOME"];
    const priorTyrumHome = process.env["TYRUM_HOME"];

    try {
      process.env["HOME"] = isolatedHome;
      process.env["TYRUM_HOME"] = "";

      const { container } = await createTestApp();
      expect(container.config.tyrumHome).toBeTruthy();
      if (container.config.tyrumHome) createdHomes.push(container.config.tyrumHome);

      await container.artifactStore.put({ kind: "log", body: Buffer.from("hello") });
      await container.db.close();

      expect(existsSync(join(isolatedHome, ".tyrum"))).toBe(false);
    } finally {
      if (priorHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = priorHome;

      if (priorTyrumHome === undefined) delete process.env["TYRUM_HOME"];
      else process.env["TYRUM_HOME"] = priorTyrumHome;

      await rm(isolatedHome, { recursive: true, force: true });
    }
  });
});
