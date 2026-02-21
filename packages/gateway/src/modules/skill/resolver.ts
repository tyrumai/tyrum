import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

export interface ResolvedSkill {
  id: string;
  name: string;
  source: "bundled" | "user" | "workspace";
  file_path: string;
  content?: string;
}

/**
 * Layered skill resolution: bundled -> user -> workspace.
 * Later layers override earlier ones for the same skill id.
 */
export class SkillResolver {
  private readonly layers: Array<{ source: "bundled" | "user" | "workspace"; directory: string }> = [];

  /** Add a resolution layer. Layers are checked in order; later layers override. */
  addLayer(source: "bundled" | "user" | "workspace", directory: string): void {
    this.layers.push({ source, directory });
  }

  /** Resolve all skills across all layers. */
  resolveAll(): ResolvedSkill[] {
    const skills = new Map<string, ResolvedSkill>();

    for (const layer of this.layers) {
      if (!existsSync(layer.directory)) continue;

      let entries: string[];
      try {
        entries = readdirSync(layer.directory);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const filePath = join(layer.directory, entry);
        const id = basename(entry, ".md").toLowerCase();

        // Only load .md skill files
        if (!entry.endsWith(".md")) continue;

        let content: string | undefined;
        try {
          content = readFileSync(filePath, "utf-8");
        } catch {
          continue;
        }

        // Later layers override earlier ones
        skills.set(id, {
          id,
          name: id,
          source: layer.source,
          file_path: filePath,
          content,
        });
      }
    }

    return Array.from(skills.values());
  }

  /** Resolve a single skill by id. Returns the highest-precedence match. */
  resolve(id: string): ResolvedSkill | undefined {
    const normalized = id.toLowerCase();
    let result: ResolvedSkill | undefined;

    for (const layer of this.layers) {
      if (!existsSync(layer.directory)) continue;

      const filePath = join(layer.directory, `${normalized}.md`);
      if (!existsSync(filePath)) continue;

      let content: string | undefined;
      try {
        content = readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      result = {
        id: normalized,
        name: normalized,
        source: layer.source,
        file_path: filePath,
        content,
      };
    }

    return result;
  }
}
