/**
 * Playbook YAML loader.
 *
 * Reads playbook.yml files, validates them against the PlaybookManifest schema,
 * and returns fully typed Playbook objects.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { PlaybookManifest, type Playbook } from "@tyrum/schemas";

/**
 * Load a single playbook from a YAML file path.
 *
 * @throws If the file cannot be read or the content fails schema validation.
 */
export function loadPlaybook(filePath: string): Playbook {
  const absolutePath = resolve(filePath);
  const raw = readFileSync(absolutePath, "utf-8");
  const parsed: unknown = parseYaml(raw);
  const manifest = PlaybookManifest.parse(parsed);

  return {
    manifest,
    file_path: absolutePath,
    loaded_at: new Date().toISOString(),
  };
}

/**
 * Scan a directory for playbook subdirectories and load each playbook.yml.
 *
 * Expects the structure: `<dir>/<playbook-name>/playbook.yml`
 *
 * Invalid playbooks are skipped with a warning logged to stderr.
 */
export function loadAllPlaybooks(dir: string): Playbook[] {
  const absoluteDir = resolve(dir);
  const playbooks: Playbook[] = [];

  let entries: string[];
  try {
    entries = readdirSync(absoluteDir);
  } catch {
    return playbooks;
  }

  for (const entry of entries) {
    const entryPath = join(absoluteDir, entry);
    try {
      if (!statSync(entryPath).isDirectory()) continue;
    } catch {
      continue;
    }

    const manifestPath = join(entryPath, "playbook.yml");
    try {
      const playbook = loadPlaybook(manifestPath);
      playbooks.push(playbook);
    } catch (err) {
      console.warn(`Skipping playbook at ${manifestPath}: ${String(err)}`);
    }
  }

  return playbooks;
}
