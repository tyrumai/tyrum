import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillResolver } from "../../src/modules/skill/resolver.js";

describe("SkillResolver", () => {
  const tempDirs: string[] = [];

  function makeTempSkillDir(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "tyrum-skills-test-"));
    tempDirs.push(dir);
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    return dir;
  }

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("resolveAll loads .md files from a single layer", () => {
    const dir = makeTempSkillDir({
      "greeting.md": "# Hello\nSay hello.",
      "farewell.md": "# Bye\nSay goodbye.",
    });

    const resolver = new SkillResolver();
    resolver.addLayer("bundled", dir);

    const skills = resolver.resolveAll();

    expect(skills).toHaveLength(2);
    const ids = skills.map(s => s.id);
    expect(ids).toContain("greeting");
    expect(ids).toContain("farewell");
    expect(skills.find(s => s.id === "greeting")!.source).toBe("bundled");
  });

  it("workspace overrides user overrides bundled", () => {
    const bundledDir = makeTempSkillDir({ "search.md": "bundled search" });
    const userDir = makeTempSkillDir({ "search.md": "user search" });
    const workspaceDir = makeTempSkillDir({ "search.md": "workspace search" });

    const resolver = new SkillResolver();
    resolver.addLayer("bundled", bundledDir);
    resolver.addLayer("user", userDir);
    resolver.addLayer("workspace", workspaceDir);

    const skills = resolver.resolveAll();

    expect(skills).toHaveLength(1);
    expect(skills[0]!.id).toBe("search");
    expect(skills[0]!.source).toBe("workspace");
    expect(skills[0]!.content).toBe("workspace search");
  });

  it("later layers only override matching ids", () => {
    const bundledDir = makeTempSkillDir({
      "alpha.md": "bundled alpha",
      "beta.md": "bundled beta",
    });
    const userDir = makeTempSkillDir({
      "beta.md": "user beta",
      "gamma.md": "user gamma",
    });

    const resolver = new SkillResolver();
    resolver.addLayer("bundled", bundledDir);
    resolver.addLayer("user", userDir);

    const skills = resolver.resolveAll();

    expect(skills).toHaveLength(3);
    const alpha = skills.find(s => s.id === "alpha")!;
    const beta = skills.find(s => s.id === "beta")!;
    const gamma = skills.find(s => s.id === "gamma")!;

    expect(alpha.source).toBe("bundled");
    expect(beta.source).toBe("user");
    expect(beta.content).toBe("user beta");
    expect(gamma.source).toBe("user");
  });

  it("resolve single skill returns highest-precedence match", () => {
    const bundledDir = makeTempSkillDir({ "deploy.md": "bundled deploy" });
    const workspaceDir = makeTempSkillDir({ "deploy.md": "workspace deploy" });

    const resolver = new SkillResolver();
    resolver.addLayer("bundled", bundledDir);
    resolver.addLayer("workspace", workspaceDir);

    const skill = resolver.resolve("deploy");

    expect(skill).toBeDefined();
    expect(skill!.source).toBe("workspace");
    expect(skill!.content).toBe("workspace deploy");
  });

  it("resolve returns undefined for unknown skill", () => {
    const dir = makeTempSkillDir({ "existing.md": "content" });
    const resolver = new SkillResolver();
    resolver.addLayer("bundled", dir);

    expect(resolver.resolve("nonexistent")).toBeUndefined();
  });

  it("non-existent directory is skipped without error", () => {
    const resolver = new SkillResolver();
    resolver.addLayer("bundled", "/tmp/tyrum-nonexistent-dir-12345");

    const skills = resolver.resolveAll();
    expect(skills).toHaveLength(0);
  });

  it("ignores non-.md files", () => {
    const dir = makeTempSkillDir({
      "valid.md": "valid skill",
      "readme.txt": "not a skill",
      "config.json": "{}",
    });

    const resolver = new SkillResolver();
    resolver.addLayer("bundled", dir);

    const skills = resolver.resolveAll();
    expect(skills).toHaveLength(1);
    expect(skills[0]!.id).toBe("valid");
  });

  it("resolve normalizes id to lowercase", () => {
    const dir = makeTempSkillDir({ "search.md": "search content" });

    const resolver = new SkillResolver();
    resolver.addLayer("bundled", dir);

    const skill = resolver.resolve("Search");
    // File on disk is lowercase, so the lookup only works when normalized
    // The resolver normalizes the ID to lowercase before searching
    expect(skill).toBeDefined();
    expect(skill!.id).toBe("search");
  });
});
