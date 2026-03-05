import { afterEach, describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  resolveAgentConfigPath,
  resolveTyrumHome,
  resolveUserSkillsDir,
  resolveUserTyrumHome,
} from "../../src/modules/agent/home.js";

describe("agent home resolution", () => {
  const originalTyrumHome = process.env["TYRUM_HOME"];

  afterEach(() => {
    if (originalTyrumHome === undefined) {
      delete process.env["TYRUM_HOME"];
      return;
    }
    process.env["TYRUM_HOME"] = originalTyrumHome;
  });

  it("resolves TYRUM_HOME when it is configured", () => {
    process.env["TYRUM_HOME"] = "/tmp/custom-tyrum-home";

    expect(resolveTyrumHome()).toBe("/tmp/custom-tyrum-home");
    expect(resolveAgentConfigPath()).toBe("/tmp/custom-tyrum-home/agent.yml");
  });

  it("keeps default user-scoped paths aligned with TYRUM_HOME", () => {
    process.env["TYRUM_HOME"] = "/tmp/custom-tyrum-home";

    expect(resolveUserTyrumHome()).toBe("/tmp/custom-tyrum-home");
    expect(resolveUserSkillsDir()).toBe("/tmp/custom-tyrum-home/skills");
  });

  it("falls back to ~/.tyrum when TYRUM_HOME is unset", () => {
    delete process.env["TYRUM_HOME"];

    expect(resolveTyrumHome()).toBe(join(homedir(), ".tyrum"));
    expect(resolveUserTyrumHome()).toBe(join(homedir(), ".tyrum"));
  });
});
