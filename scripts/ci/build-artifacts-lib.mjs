import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

export const ARTIFACT_MANIFEST_FILENAME = "ci-artifact-manifest.json";
export const ARTIFACT_SCHEMA_VERSION = 1;
const TAR_GZ_ARCHIVE_FORMAT = "tar.gz";
const MACOS_DESKTOP_RELEASE_OUTPUT = "apps/desktop/release";

const BUILD_ARTIFACT_GROUPS = {
  "linux-workspace-builds": {
    requiredOutputs: [],
    collectOutputs: (repoRoot) => collectWorkspaceDistDirs(repoRoot),
  },
  "desktop-suite-builds": {
    requiredOutputs: ["apps/desktop/release"],
    collectOutputs: (repoRoot) => [
      ...collectWorkspaceDistDirs(repoRoot),
      resolve(repoRoot, "apps/desktop/release"),
    ],
  },
};

function normalizeRelativePath(value) {
  return value.split(sep).join("/");
}

function relativeRepoPath(repoRoot, absolutePath) {
  const rel = normalizeRelativePath(relative(repoRoot, absolutePath));
  if (!rel || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    throw new Error(`Artifact path escapes repo root: ${absolutePath}`);
  }
  return rel;
}

function pathContainsHiddenSegment(relativePath) {
  return normalizeRelativePath(relativePath)
    .split("/")
    .some((segment) => segment.startsWith("."));
}

function collectDistDirsWithin(repoRoot, parentDirName) {
  const parentDir = resolve(repoRoot, parentDirName);
  if (!existsSync(parentDir)) return [];

  const outputs = [];
  for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const distDir = resolve(parentDir, entry.name, "dist");
    if (existsSync(distDir)) outputs.push(distDir);
  }
  return outputs;
}

function collectWorkspaceDistDirs(repoRoot) {
  return [
    ...collectDistDirsWithin(repoRoot, "packages"),
    ...collectDistDirsWithin(repoRoot, "apps"),
  ].toSorted((left, right) => left.localeCompare(right));
}

export function computeLockfileHash(repoRoot) {
  const lockfilePath = resolve(repoRoot, "pnpm-lock.yaml");
  return createHash("sha256").update(readFileSync(lockfilePath)).digest("hex");
}

export function resolveBuildArtifactOutputs(repoRoot, groupName) {
  const group = BUILD_ARTIFACT_GROUPS[groupName];
  if (!group) {
    throw new Error(`Unknown build artifact group: ${groupName}`);
  }

  for (const requiredOutput of group.requiredOutputs) {
    const requiredPath = resolve(repoRoot, requiredOutput);
    if (!existsSync(requiredPath)) {
      throw new Error(
        `Required artifact output is missing for ${groupName}: ${relativeRepoPath(repoRoot, requiredPath)}`,
      );
    }
  }

  const outputs = group.collectOutputs(repoRoot).filter((outputPath, index, allOutputs) => {
    return existsSync(outputPath) && allOutputs.indexOf(outputPath) === index;
  });
  if (outputs.length === 0) {
    throw new Error(`No build outputs found for artifact group ${groupName}.`);
  }
  return outputs;
}

export function createBuildArtifactManifest({
  repoRoot,
  groupName,
  outputs,
  gitSha,
  runnerOs,
  nodeVersion,
  archivedOutputs = {},
}) {
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    group: groupName,
    gitSha,
    runnerOs,
    nodeVersion,
    lockfileHash: computeLockfileHash(repoRoot),
    outputs: outputs.map((outputPath) => relativeRepoPath(repoRoot, outputPath)),
    archivedOutputs,
    fileModes: collectArtifactFileModes(repoRoot, outputs),
  };
}

function assertManifestOutputPath(outputPath) {
  const normalizedPath =
    typeof outputPath === "string" ? normalizeRelativePath(outputPath) : String(outputPath);
  const pathSegments = normalizedPath.split("/");

  if (
    typeof outputPath !== "string" ||
    outputPath.length === 0 ||
    isAbsolute(outputPath) ||
    normalizedPath.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalizedPath) ||
    pathSegments.some((segment) => segment.length === 0 || segment === "..")
  ) {
    throw new Error(`Invalid artifact output path in manifest: ${String(outputPath)}`);
  }
}

function validateArtifactFileModes(manifest) {
  if (manifest.fileModes === undefined) return;
  if (
    typeof manifest.fileModes !== "object" ||
    manifest.fileModes === null ||
    Array.isArray(manifest.fileModes)
  ) {
    throw new Error("Artifact manifest file modes must be an object.");
  }

  for (const [relativePath, mode] of Object.entries(manifest.fileModes)) {
    assertManifestOutputPath(relativePath);
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) {
      throw new Error(`Invalid artifact file mode for ${relativePath}: ${String(mode)}`);
    }
  }
}

function validateArchivedOutputs(manifest) {
  if (manifest.archivedOutputs === undefined) return;
  if (
    typeof manifest.archivedOutputs !== "object" ||
    manifest.archivedOutputs === null ||
    Array.isArray(manifest.archivedOutputs)
  ) {
    throw new Error("Artifact manifest archived outputs must be an object.");
  }

  for (const [outputPath, archiveInfo] of Object.entries(manifest.archivedOutputs)) {
    assertManifestOutputPath(outputPath);
    if (!manifest.outputs.includes(outputPath)) {
      throw new Error(`Archived artifact output is not listed in outputs: ${outputPath}`);
    }
    if (
      typeof archiveInfo !== "object" ||
      archiveInfo === null ||
      Array.isArray(archiveInfo) ||
      typeof archiveInfo.archivePath !== "string" ||
      archiveInfo.archivePath.length === 0
    ) {
      throw new Error(`Invalid archived output metadata for ${outputPath}`);
    }
    assertManifestOutputPath(archiveInfo.archivePath);
    if (archiveInfo.format !== TAR_GZ_ARCHIVE_FORMAT) {
      throw new Error(
        `Unsupported archived output format for ${outputPath}: ${String(archiveInfo.format)}`,
      );
    }
  }
}

export function validateBuildArtifactManifest({
  repoRoot,
  manifest,
  expectedGroupName,
  expectedGitSha,
  expectedRunnerOs,
  expectedNodeVersion,
}) {
  if (manifest?.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    throw new Error(
      `Artifact manifest schema mismatch: expected ${String(ARTIFACT_SCHEMA_VERSION)}, got ${String(manifest?.schemaVersion)}`,
    );
  }
  if (typeof manifest.group !== "string" || manifest.group.length === 0) {
    throw new Error("Artifact manifest is missing the group name.");
  }
  const group = BUILD_ARTIFACT_GROUPS[manifest.group];
  if (!group) {
    throw new Error(`Artifact manifest references unknown group: ${String(manifest.group)}`);
  }
  if (expectedGroupName && manifest.group !== expectedGroupName) {
    throw new Error(
      `Artifact manifest group mismatch: expected ${expectedGroupName}, got ${manifest.group}`,
    );
  }
  if (expectedGitSha && manifest.gitSha !== expectedGitSha) {
    throw new Error(
      `Artifact manifest git SHA mismatch: expected ${expectedGitSha}, got ${String(manifest.gitSha)}`,
    );
  }
  if (expectedRunnerOs && manifest.runnerOs !== expectedRunnerOs) {
    throw new Error(
      `Artifact manifest runner OS mismatch: expected ${expectedRunnerOs}, got ${String(manifest.runnerOs)}`,
    );
  }
  if (expectedNodeVersion && manifest.nodeVersion !== expectedNodeVersion) {
    throw new Error(
      `Artifact manifest node version mismatch: expected ${expectedNodeVersion}, got ${String(manifest.nodeVersion)}`,
    );
  }

  const actualLockfileHash = computeLockfileHash(repoRoot);
  if (manifest.lockfileHash !== actualLockfileHash) {
    throw new Error(
      `Artifact manifest lockfile hash mismatch: expected ${actualLockfileHash}, got ${String(manifest.lockfileHash)}`,
    );
  }

  if (!Array.isArray(manifest.outputs) || manifest.outputs.length === 0) {
    throw new Error("Artifact manifest does not list any outputs.");
  }
  for (const requiredOutput of group.requiredOutputs) {
    if (!manifest.outputs.includes(requiredOutput)) {
      throw new Error(
        `Artifact manifest is missing required output for ${manifest.group}: ${requiredOutput}`,
      );
    }
  }
  for (const outputPath of manifest.outputs) {
    assertManifestOutputPath(outputPath);
  }
  validateArchivedOutputs(manifest);
  validateArtifactFileModes(manifest);
}

function copyPath(sourcePath, targetPath) {
  const sourceStats = statSync(sourcePath);
  rmSync(targetPath, { recursive: true, force: true });
  mkdirSync(dirname(targetPath), { recursive: true });

  if (sourceStats.isDirectory()) {
    cpSync(sourcePath, targetPath, {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    });
    return;
  }

  cpSync(sourcePath, targetPath, { force: true, verbatimSymlinks: true });
}

function shouldArchiveOutput(groupName, runnerOs, relativePath) {
  return (
    groupName === "desktop-suite-builds" &&
    runnerOs === "macOS" &&
    relativePath === MACOS_DESKTOP_RELEASE_OUTPUT
  );
}

function tarArchivePath(relativePath) {
  return `${relativePath}.tar.gz`;
}

function runTarCommand(args, errorPrefix, cwd) {
  const result = spawnSync("tar", args, {
    cwd,
    encoding: "utf8",
  });

  if (result.status === 0) return;

  throw new Error([errorPrefix, result.stdout, result.stderr].filter(Boolean).join("\n"));
}

function archiveOutputPath({ repoRoot, relativePath, artifactDir }) {
  const archiveRelativePath = tarArchivePath(relativePath);
  const archiveAbsolutePath = resolve(artifactDir, archiveRelativePath);
  rmSync(archiveAbsolutePath, { force: true });
  mkdirSync(dirname(archiveAbsolutePath), { recursive: true });
  runTarCommand(
    ["-czf", archiveAbsolutePath, "-C", repoRoot, relativePath],
    `Failed to archive artifact output ${relativePath}.`,
    repoRoot,
  );
  return {
    archivePath: archiveRelativePath,
    format: TAR_GZ_ARCHIVE_FORMAT,
  };
}

function restoreArchivedOutput({ repoRoot, artifactDir, relativePath, archiveInfo }) {
  const archiveSourcePath = resolve(artifactDir, archiveInfo.archivePath);
  if (!existsSync(archiveSourcePath)) {
    throw new Error(`Archived artifact output is missing: ${archiveInfo.archivePath}`);
  }

  const restorePath = resolve(repoRoot, relativePath);
  rmSync(restorePath, { recursive: true, force: true });
  mkdirSync(dirname(restorePath), { recursive: true });
  runTarCommand(
    ["-xzf", archiveSourcePath, "-C", repoRoot],
    `Failed to restore archived artifact output ${relativePath}.`,
    repoRoot,
  );
}

function collectArtifactFileModesWithin(repoRoot, absolutePath, fileModes) {
  const relativePath = relativeRepoPath(repoRoot, absolutePath);
  if (pathContainsHiddenSegment(relativePath)) {
    return;
  }

  const sourceStats = statSync(absolutePath);
  if (sourceStats.isDirectory()) {
    const entries = readdirSync(absolutePath, { withFileTypes: true }).toSorted((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      collectArtifactFileModesWithin(repoRoot, resolve(absolutePath, entry.name), fileModes);
    }
    return;
  }

  fileModes[relativePath] = sourceStats.mode & 0o777;
}

function collectArtifactFileModes(repoRoot, outputs) {
  const fileModes = {};
  for (const outputPath of outputs) {
    collectArtifactFileModesWithin(repoRoot, outputPath, fileModes);
  }
  return fileModes;
}

export function stageBuildArtifact({
  repoRoot,
  artifactDir,
  groupName,
  gitSha,
  runnerOs,
  nodeVersion,
}) {
  const outputs = resolveBuildArtifactOutputs(repoRoot, groupName);
  const archivedOutputs = {};

  rmSync(artifactDir, { recursive: true, force: true });
  mkdirSync(artifactDir, { recursive: true });

  for (const outputPath of outputs) {
    const relativePath = relativeRepoPath(repoRoot, outputPath);
    if (shouldArchiveOutput(groupName, runnerOs, relativePath)) {
      archivedOutputs[relativePath] = archiveOutputPath({
        repoRoot,
        relativePath,
        artifactDir,
      });
      continue;
    }
    copyPath(outputPath, resolve(artifactDir, relativePath));
  }

  const manifest = createBuildArtifactManifest({
    repoRoot,
    groupName,
    outputs,
    gitSha,
    runnerOs,
    nodeVersion,
    archivedOutputs,
  });
  writeFileSync(
    resolve(artifactDir, ARTIFACT_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

export function restoreBuildArtifact({
  repoRoot,
  artifactDir,
  expectedGroupName,
  expectedGitSha,
  expectedRunnerOs,
  expectedNodeVersion,
}) {
  const manifestPath = resolve(artifactDir, ARTIFACT_MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    throw new Error(`Artifact manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  validateBuildArtifactManifest({
    repoRoot,
    manifest,
    expectedGroupName,
    expectedGitSha,
    expectedRunnerOs,
    expectedNodeVersion,
  });

  const archivedOutputs =
    manifest.archivedOutputs &&
    typeof manifest.archivedOutputs === "object" &&
    !Array.isArray(manifest.archivedOutputs)
      ? manifest.archivedOutputs
      : {};

  for (const relativePath of manifest.outputs) {
    const archiveInfo = archivedOutputs[relativePath];
    if (archiveInfo) {
      restoreArchivedOutput({ repoRoot, artifactDir, relativePath, archiveInfo });
      continue;
    }
    const sourcePath = resolve(artifactDir, relativePath);
    if (!existsSync(sourcePath)) {
      throw new Error(`Artifact output listed in manifest is missing: ${relativePath}`);
    }
    copyPath(sourcePath, resolve(repoRoot, relativePath));
  }

  const fileModes =
    manifest.fileModes &&
    typeof manifest.fileModes === "object" &&
    !Array.isArray(manifest.fileModes)
      ? manifest.fileModes
      : {};
  for (const [relativePath, mode] of Object.entries(fileModes)) {
    const restoredPath = resolve(repoRoot, relativePath);
    if (!existsSync(restoredPath)) {
      throw new Error(
        `Artifact file mode listed in manifest is missing after restore: ${relativePath}`,
      );
    }
    chmodSync(restoredPath, mode);
  }

  return manifest;
}
