import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
  SkillManifest as SkillManifestT,
  McpServerSpec as McpServerSpecT,
} from "@tyrum/schemas";
import {
  resolveAgentConfigPath,
  resolveIdentityPath,
  resolveSkillsDir,
  resolveMcpDir,
} from "./home.js";
import { parseFrontmatterDocument } from "./frontmatter.js";

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
): Promise<SkillManifestT | undefined> {
  const skillPath = join(skillsDir, skillId, "SKILL.md");
  try {
    const contents = await readFile(skillPath, "utf-8");
    const parsed = parseFrontmatterDocument(contents);
    return SkillManifest.parse({
      meta: parsed.frontmatter,
      body: parsed.body.trim(),
    });
  } catch {
    return undefined;
  }
}

export async function loadEnabledSkills(
  home: string,
  config: AgentConfigT,
): Promise<SkillManifestT[]> {
  const skillsDir = resolveSkillsDir(home);
  const loaded: SkillManifestT[] = [];

  for (const skillId of config.skills.enabled) {
    const manifest = await loadSkillFromDir(skillsDir, skillId);
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
  const serverPath = join(mcpDir, serverId, "server.yml");
  try {
    const contents = await readFile(serverPath, "utf-8");
    const parsed = readYamlObject(contents);
    return McpServerSpec.parse(parsed);
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
