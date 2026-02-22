import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadEnabledSkills } from "../../src/modules/agent/workspace.js";

function skillDoc(body: string): string {
  return `---\n` +
    `id: example\n` +
    `name: Example\n` +
    `version: 0.0.1\n` +
    `---\n` +
    `${body}\n`;
}

describe("skills load order", () => {
  let userHome: string | undefined;
  let workspaceHome: string | undefined;
  const originalUserHome = process.env["TYRUM_USER_HOME"];

  afterEach(async () => {
    if (originalUserHome === undefined) {
      delete process.env["TYRUM_USER_HOME"];
    } else {
      process.env["TYRUM_USER_HOME"] = originalUserHome;
    }

    if (userHome) {
      await rm(userHome, { recursive: true, force: true });
      userHome = undefined;
    }
    if (workspaceHome) {
      await rm(workspaceHome, { recursive: true, force: true });
      workspaceHome = undefined;
    }
  });

  it("prefers workspace over user over bundled", async () => {
    userHome = await mkdtemp(join(tmpdir(), "tyrum-user-home-"));
    workspaceHome = await mkdtemp(join(tmpdir(), "tyrum-workspace-home-"));
    process.env["TYRUM_USER_HOME"] = userHome;

    await mkdir(join(userHome, "skills/example"), { recursive: true });
    await writeFile(join(userHome, "skills/example/SKILL.md"), skillDoc("user"), "utf-8");

    await mkdir(join(workspaceHome, "skills/example"), { recursive: true });
    await writeFile(join(workspaceHome, "skills/example/SKILL.md"), skillDoc("workspace"), "utf-8");

    const skills = await loadEnabledSkills(workspaceHome, {
      skills: { enabled: ["example"] },
    } as unknown as { skills: { enabled: string[] } });

    expect(skills).toHaveLength(1);
    expect(skills[0]!.body).toContain("workspace");
  });

  it("falls back to user when workspace skill is absent", async () => {
    userHome = await mkdtemp(join(tmpdir(), "tyrum-user-home-"));
    workspaceHome = await mkdtemp(join(tmpdir(), "tyrum-workspace-home-"));
    process.env["TYRUM_USER_HOME"] = userHome;

    await mkdir(join(userHome, "skills/example"), { recursive: true });
    await writeFile(join(userHome, "skills/example/SKILL.md"), skillDoc("user"), "utf-8");

    const skills = await loadEnabledSkills(workspaceHome, {
      skills: { enabled: ["example"] },
    } as unknown as { skills: { enabled: string[] } });

    expect(skills).toHaveLength(1);
    expect(skills[0]!.body).toContain("user");
  });

  it("falls back to bundled when neither workspace nor user provides the skill", async () => {
    userHome = await mkdtemp(join(tmpdir(), "tyrum-user-home-"));
    workspaceHome = await mkdtemp(join(tmpdir(), "tyrum-workspace-home-"));
    process.env["TYRUM_USER_HOME"] = userHome;

    const skills = await loadEnabledSkills(workspaceHome, {
      skills: { enabled: ["example"] },
    } as unknown as { skills: { enabled: string[] } });

    expect(skills).toHaveLength(1);
    expect(skills[0]!.meta.id).toBe("example");
  });
});

