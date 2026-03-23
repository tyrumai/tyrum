import { createHash } from "node:crypto";
import {
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

export const ARTIFACT_MANIFEST_FILENAME = "ci-artifact-manifest.json";
export const ARTIFACT_SCHEMA_VERSION = 1;

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
}) {
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    group: groupName,
    gitSha,
    runnerOs,
    nodeVersion,
    lockfileHash: computeLockfileHash(repoRoot),
    outputs: outputs.map((outputPath) => relativeRepoPath(repoRoot, outputPath)),
  };
}

function assertManifestOutputPath(outputPath) {
  if (
    typeof outputPath !== "string" ||
    outputPath.length === 0 ||
    outputPath === ".." ||
    outputPath.startsWith("../") ||
    isAbsolute(outputPath)
  ) {
    throw new Error(`Invalid artifact output path in manifest: ${String(outputPath)}`);
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
}

function copyPath(sourcePath, targetPath) {
  const sourceStats = statSync(sourcePath);
  rmSync(targetPath, { recursive: true, force: true });
  mkdirSync(dirname(targetPath), { recursive: true });

  if (sourceStats.isDirectory()) {
    cpSync(sourcePath, targetPath, { recursive: true, force: true });
    return;
  }

  cpSync(sourcePath, targetPath, { force: true });
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

  rmSync(artifactDir, { recursive: true, force: true });
  mkdirSync(artifactDir, { recursive: true });

  for (const outputPath of outputs) {
    const relativePath = relativeRepoPath(repoRoot, outputPath);
    copyPath(outputPath, resolve(artifactDir, relativePath));
  }

  const manifest = createBuildArtifactManifest({
    repoRoot,
    groupName,
    outputs,
    gitSha,
    runnerOs,
    nodeVersion,
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

  for (const relativePath of manifest.outputs) {
    const sourcePath = resolve(artifactDir, relativePath);
    if (!existsSync(sourcePath)) {
      throw new Error(`Artifact output listed in manifest is missing: ${relativePath}`);
    }
    copyPath(sourcePath, resolve(repoRoot, relativePath));
  }

  return manifest;
}
