import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentConfig } from "@tyrum/schemas";
import { loadEnabledSkills } from "../../src/modules/agent/workspace.js";

function skillDoc(body: string): string {
  return `---
id: example
name: Example
version: 0.0.1
---
${body}
`;
}

describe("skills load order", () => {
  let userHome: string | undefined;
  let workspaceHome: string | undefined;

  afterEach(async () => {
    if (userHome) {
      await rm(userHome, { recursive: true, force: true });
      userHome = undefined;
    }
    if (workspaceHome) {
      await rm(workspaceHome, { recursive: true, force: true });
      workspaceHome = undefined;
    }
  });

  it("prefers workspace over user over bundled when workspace skills are trusted", async () => {
    userHome = await mkdtemp(join(tmpdir(), "tyrum-user-home-"));
    workspaceHome = await mkdtemp(join(tmpdir(), "tyrum-workspace-home-"));

    await mkdir(join(userHome, "skills/example"), { recursive: true });
    await writeFile(join(userHome, "skills/example/SKILL.md"), skillDoc("user"), "utf-8");

    await mkdir(join(workspaceHome, "skills/example"), { recursive: true });
    await writeFile(join(workspaceHome, "skills/example/SKILL.md"), skillDoc("workspace"), "utf-8");

    // Inject the temp user skills directory without relying on runtime env configuration.
    // (Gateway runtime no longer reads TYRUM_USER_HOME.)
    const skills = await loadEnabledSkills(
      workspaceHome,
      AgentConfig.parse({
        model: { model: null },
        skills: {
          default_mode: "deny",
          allow: ["example"],
          deny: [],
          workspace_trusted: true,
        },
      }),
      { userSkillsDir: join(userHome, "skills") },
    );
    expect(skills).toHaveLength(1);
    expect(skills[0]!.body).toContain("workspace");
    expect(skills[0]!.provenance.source).toBe("workspace");
  });

  it("falls back to user when workspace skill is absent", async () => {
    userHome = await mkdtemp(join(tmpdir(), "tyrum-user-home-"));
    workspaceHome = await mkdtemp(join(tmpdir(), "tyrum-workspace-home-"));

    await mkdir(join(userHome, "skills/example"), { recursive: true });
    await writeFile(join(userHome, "skills/example/SKILL.md"), skillDoc("user"), "utf-8");

    const skills = await loadEnabledSkills(
      workspaceHome,
      AgentConfig.parse({
        model: { model: null },
        skills: {
          default_mode: "deny",
          allow: ["example"],
          deny: [],
          workspace_trusted: false,
        },
      }),
      { userSkillsDir: join(userHome, "skills") },
    );

    expect(skills).toHaveLength(1);
    expect(skills[0]!.body).toContain("user");
    expect(skills[0]!.provenance.source).toBe("user");
  });

  it("prefers user over bundled when workspace skills are not trusted", async () => {
    userHome = await mkdtemp(join(tmpdir(), "tyrum-user-home-"));
    workspaceHome = await mkdtemp(join(tmpdir(), "tyrum-workspace-home-"));

    await mkdir(join(userHome, "skills/example"), { recursive: true });
    await writeFile(join(userHome, "skills/example/SKILL.md"), skillDoc("user"), "utf-8");

    await mkdir(join(workspaceHome, "skills/example"), { recursive: true });
    await writeFile(join(workspaceHome, "skills/example/SKILL.md"), skillDoc("workspace"), "utf-8");

    const skills = await loadEnabledSkills(
      workspaceHome,
      AgentConfig.parse({
        model: { model: null },
        skills: {
          default_mode: "deny",
          allow: ["example"],
          deny: [],
          workspace_trusted: false,
        },
      }),
      { userSkillsDir: join(userHome, "skills") },
    );

    expect(skills).toHaveLength(1);
    expect(skills[0]!.body).toContain("user");
    expect(skills[0]!.provenance.source).toBe("user");
  });

  it("falls back to bundled when workspace skills are not trusted and user skill is absent", async () => {
    userHome = await mkdtemp(join(tmpdir(), "tyrum-user-home-"));
    workspaceHome = await mkdtemp(join(tmpdir(), "tyrum-workspace-home-"));

    await mkdir(join(workspaceHome, "skills/example"), { recursive: true });
    await writeFile(join(workspaceHome, "skills/example/SKILL.md"), skillDoc("workspace"), "utf-8");

    const skills = await loadEnabledSkills(
      workspaceHome,
      AgentConfig.parse({
        model: { model: null },
        skills: {
          default_mode: "deny",
          allow: ["example"],
          deny: [],
          workspace_trusted: false,
        },
      }),
      { userSkillsDir: join(userHome, "skills") },
    );

    expect(skills).toHaveLength(1);
    expect(skills[0]!.meta.id).toBe("example");
    expect(skills[0]!.meta.version).toBe("0.1.0");
    expect(skills[0]!.provenance.source).toBe("bundled");
  });
});
