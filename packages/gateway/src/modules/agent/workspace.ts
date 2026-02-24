import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  AgentConfig,
  IdentityPack,
  SkillManifest,
  McpServerSpec,
} from "@tyrum/schemas";
import type {
  AgentConfig as AgentConfigT,
  IdentityPack as IdentityPackT,
  SkillProvenanceSource as SkillProvenanceSourceT,
  SkillManifest as SkillManifestT,
  McpServerSpec as McpServerSpecT,
} from "@tyrum/schemas";
import {
  resolveAgentConfigPath,
  resolveIdentityPath,
  resolveSkillsDir,
  resolveUserSkillsDir,
  resolveBundledSkillsDir,
  resolveMcpDir,
} from "./home.js";
import { parseFrontmatterDocument } from "./frontmatter.js";

export type SkillProvenanceSource = SkillProvenanceSourceT;
export type SkillProvenance = { source: SkillProvenanceSource; path: string };
export type LoadedSkillManifest = SkillManifestT & { provenance: SkillProvenance };

function readYamlObject(contents: string): Record<string, unknown> {
  const parsed = parseYaml(contents);
  if (!parsed || typeof parsed !== "object") {
    return {};
  }
  return parsed as Record<string, unknown>;
}

export async function loadAgentConfig(home: string): Promise<AgentConfigT> {
  const path = resolveAgentConfigPath(home);
  const contents = await readFile(path, "utf-8");
  return AgentConfig.parse(readYamlObject(contents));
}

export async function loadIdentity(home: string): Promise<IdentityPackT> {
  const path = resolveIdentityPath(home);
  const contents = await readFile(path, "utf-8");
  const parsed = parseFrontmatterDocument(contents);
  return IdentityPack.parse({
    meta: parsed.frontmatter,
    body: parsed.body.trim(),
  });
}

async function loadSkillFromDir(
  skillsDir: string,
  skillId: string,
  source: SkillProvenanceSource,
): Promise<LoadedSkillManifest | undefined> {
  const skillPath = join(skillsDir, skillId, "SKILL.md");
  try {
    const contents = await readFile(skillPath, "utf-8");
    const parsed = parseFrontmatterDocument(contents);
    const manifest = SkillManifest.parse({
      meta: parsed.frontmatter,
      body: parsed.body.trim(),
    });
    return {
      ...manifest,
      provenance: {
        source,
        path: skillPath,
      },
    };
  } catch {
    return undefined;
  }
}

export async function loadEnabledSkills(
  home: string,
  config: AgentConfigT,
): Promise<LoadedSkillManifest[]> {
  const loaded: LoadedSkillManifest[] = [];

  const userSkillsDir = resolveUserSkillsDir();
  const bundledSkillsDir = resolveBundledSkillsDir();
  const workspaceSkillsDir = resolveSkillsDir(home);
  const workspaceTrusted = config.skills.workspace_trusted === true;

  for (const skillId of config.skills.enabled) {
    const manifest =
      (workspaceTrusted
        ? await loadSkillFromDir(workspaceSkillsDir, skillId, "workspace")
        : undefined) ??
      (await loadSkillFromDir(userSkillsDir, skillId, "user")) ??
      (await loadSkillFromDir(bundledSkillsDir, skillId, "bundled"));
    if (manifest) {
      loaded.push(manifest);
    }
  }

  return loaded;
}

async function loadMcpServerFromDir(
  mcpDir: string,
  serverId: string,
): Promise<McpServerSpecT | undefined> {
  const serverDir = join(mcpDir, serverId);
  const serverPath = join(serverDir, "server.yml");
  try {
    const contents = await readFile(serverPath, "utf-8");
    const parsed = readYamlObject(contents);
    let spec = McpServerSpec.parse(parsed);

    // Keep IDs consistent with the directory/config key.
    if (spec.id !== serverId) {
      spec = { ...spec, id: serverId };
    }

    // Make relative commands/args behave predictably by defaulting cwd to the install dir.
    if (spec.transport === "stdio") {
      if (!spec.cwd) {
        spec = { ...spec, cwd: serverDir };
      } else if (!isAbsolute(spec.cwd)) {
        spec = { ...spec, cwd: join(serverDir, spec.cwd) };
      }
    }

    return spec;
  } catch {
    return undefined;
  }
}

export async function loadEnabledMcpServers(
  home: string,
  config: AgentConfigT,
): Promise<McpServerSpecT[]> {
  const mcpDir = resolveMcpDir(home);
  const loaded: McpServerSpecT[] = [];

  for (const serverId of config.mcp.enabled) {
    const spec = await loadMcpServerFromDir(mcpDir, serverId);
    if (spec) {
      loaded.push(spec);
    }
  }

  return loaded;
}
