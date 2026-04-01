import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathExists } from "./path-exists.js";

const OPERATOR_UI_REFERENCE_PATTERN = /(?:src|href)="\/ui\/([^"]+)"/g;

export function listOperatorUiReferencedPaths(indexHtml: string): string[] {
  const referencedPaths = new Set<string>();
  for (const match of indexHtml.matchAll(OPERATOR_UI_REFERENCE_PATTERN)) {
    const referencedPath = match[1]?.trim();
    if (referencedPath) {
      referencedPaths.add(referencedPath);
    }
  }
  return [...referencedPaths];
}

export async function hasCompleteOperatorUiSnapshot(assetsDir: string): Promise<boolean> {
  const indexPath = join(assetsDir, "index.html");
  if (!(await pathExists(indexPath))) {
    return false;
  }

  const indexHtml = await readFile(indexPath, "utf8");
  const referencedPaths = listOperatorUiReferencedPaths(indexHtml);
  if (referencedPaths.length === 0) {
    return false;
  }
  for (const referencedPath of referencedPaths) {
    if (!(await pathExists(join(assetsDir, referencedPath)))) {
      return false;
    }
  }

  return true;
}
