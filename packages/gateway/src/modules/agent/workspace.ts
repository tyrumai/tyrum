import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { SkillManifest, McpServerSpec } from "@tyrum/contracts";
import type {
  AgentConfig as AgentConfigT,
  SkillProvenanceSource as SkillProvenanceSourceT,
  SkillManifest as SkillManifestT,
  McpServerSpec as McpServerSpecT,
} from "@tyrum/contracts";
import {
  resolveSkillsDir,
  resolveUserSkillsDir,
  resolveBundledSkillsDir,
  resolveMcpDir,
} from "./home.js";
import { isAgentAccessAllowed } from "./access-config.js";
import { parseFrontmatterDocument } from "./frontmatter.js";
import type { Logger } from "../observability/logger.js";

export type SkillProvenanceSource = SkillProvenanceSourceT | "shared";
export type SkillProvenance = { source: SkillProvenanceSource; path: string };
export type LoadedSkillManifest = SkillManifestT & { provenance: SkillProvenance };

function readYamlObject(contents: string): Record<string, unknown> {
  const parsed = parseYaml(contents);
  if (!parsed || typeof parsed !== "object") {
    return {};
  }
  return parsed as Record<string, unknown>;
}

async function listDirectoryNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted((left, right) => left.localeCompare(right));
  } catch {
    // Intentional: missing skills/MCP directories are treated as empty inventories.
    return [];
  }
}

export async function listSkillsFromDir(
  skillsDir: string,
  source: SkillProvenanceSource,
  logger?: Logger,
): Promise<LoadedSkillManifest[]> {
  const skillIds = await listDirectoryNames(skillsDir);
  const loaded: LoadedSkillManifest[] = [];

  for (const skillId of skillIds) {
    const manifest = await loadSkillFromDir(skillsDir, skillId, source, logger);
    if (manifest) loaded.push(manifest);
  }

  return loaded;
}

export async function loadSkillFromDir(
  skillsDir: string,
  skillId: string,
  source: SkillProvenanceSource,
  logger?: Logger,
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.warn("agent.skill_load_failed", { skill_id: skillId, path: skillPath, error: message });
    return undefined;
  }
}

export async function loadEnabledSkills(
  home: string,
  config: AgentConfigT,
  opts?: { logger?: Logger; userSkillsDir?: string; bundledSkillsDir?: string },
): Promise<LoadedSkillManifest[]> {
  const userSkillsDir = opts?.userSkillsDir ?? resolveUserSkillsDir();
  const bundledSkillsDir = opts?.bundledSkillsDir ?? resolveBundledSkillsDir();
  const workspaceSkillsDir = resolveSkillsDir(home);
  const workspaceTrusted = config.skills.workspace_trusted === true;
  const orderedSkillIds = [
    ...(workspaceTrusted ? await listDirectoryNames(workspaceSkillsDir) : []),
    ...(await listDirectoryNames(userSkillsDir)),
    ...(await listDirectoryNames(bundledSkillsDir)),
  ];
  const loaded: LoadedSkillManifest[] = [];
  const seen = new Set<string>();

  for (const skillId of orderedSkillIds) {
    const normalizedSkillId = skillId.trim();
    if (
      normalizedSkillId.length === 0 ||
      seen.has(normalizedSkillId) ||
      !isAgentAccessAllowed(config.skills, normalizedSkillId)
    ) {
      continue;
    }
    seen.add(normalizedSkillId);

    const manifest =
      (workspaceTrusted
        ? await loadSkillFromDir(workspaceSkillsDir, normalizedSkillId, "workspace", opts?.logger)
        : undefined) ??
      (await loadSkillFromDir(userSkillsDir, normalizedSkillId, "user", opts?.logger)) ??
      (await loadSkillFromDir(bundledSkillsDir, normalizedSkillId, "bundled", opts?.logger));
    if (manifest) loaded.push(manifest);
  }

  return loaded;
}

async function loadMcpServerFromDir(
  mcpDir: string,
  serverId: string,
  logger?: Logger,
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.warn("mcp.server_spec_load_failed", {
      server_id: serverId,
      path: serverPath,
      error: message,
    });
    return undefined;
  }
}

export async function listMcpServersFromDir(
  mcpDir: string,
  logger?: Logger,
): Promise<McpServerSpecT[]> {
  const serverIds = await listDirectoryNames(mcpDir);
  const loaded: McpServerSpecT[] = [];

  for (const serverId of serverIds) {
    const spec = await loadMcpServerFromDir(mcpDir, serverId, logger);
    if (spec) loaded.push(spec);
  }

  return loaded;
}

export async function loadEnabledMcpServers(
  home: string,
  config: AgentConfigT,
  opts?: { logger?: Logger },
): Promise<McpServerSpecT[]> {
  const mcpDir = resolveMcpDir(home);
  return (await listMcpServersFromDir(mcpDir, opts?.logger)).filter((spec) =>
    isAgentAccessAllowed(config.mcp, spec.id),
  );
}
