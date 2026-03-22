import { copyFileSync, cpSync, lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";

function copyResolvedTarget(sourcePath, targetPath) {
  const sourceStats = lstatSync(sourcePath);
  if (sourceStats.isDirectory()) {
    cpSync(sourcePath, targetPath, { recursive: true });
    return true;
  }
  copyFileSync(sourcePath, targetPath);
  return false;
}

export function materializeSymbolicLinks(rootDir) {
  const dirsToVisit = [rootDir];

  while (dirsToVisit.length > 0) {
    const currentDir = dirsToVisit.pop();
    if (!currentDir) continue;

    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = join(currentDir, entry.name);
      const entryStats = lstatSync(entryPath);

      if (entryStats.isSymbolicLink()) {
        let resolvedTarget;
        try {
          resolvedTarget = realpathSync(entryPath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to resolve staged gateway link at ${entryPath}: ${message}`);
        }

        rmSync(entryPath, { recursive: true, force: true });
        if (copyResolvedTarget(resolvedTarget, entryPath)) {
          dirsToVisit.push(entryPath);
        }
        continue;
      }

      if (entryStats.isDirectory()) {
        dirsToVisit.push(entryPath);
      }
    }
  }
}
