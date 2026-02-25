import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  resolveBundledSkillsDir,
  resolveBundledSkillsDirFrom,
} from "../../src/modules/agent/home.js";

describe("resolveBundledSkillsDir", () => {
  it("resolves the bundled skills directory", async () => {
    const skillsDir = resolveBundledSkillsDir();
    const exampleSkill = await readFile(join(skillsDir, "example", "SKILL.md"), "utf-8");
    expect(exampleSkill).toContain("name:");
  });

  it("resolves correctly from a dist/ bundle location", () => {
    const skillsDir = resolveBundledSkillsDir();
    const gatewayRoot = dirname(skillsDir);
    const fromDist = resolveBundledSkillsDirFrom(join(gatewayRoot, "dist"));
    expect(fromDist).toBe(skillsDir);
  });
});
