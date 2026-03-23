import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stageBuildArtifact } from "./build-artifacts-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

function readArg(flagName) {
  const args = process.argv.slice(2);
  const directIndex = args.indexOf(flagName);
  if (directIndex >= 0) {
    return args[directIndex + 1];
  }

  const prefixed = args.find((candidate) => candidate.startsWith(`${flagName}=`));
  return prefixed ? prefixed.slice(flagName.length + 1) : undefined;
}

const groupName = readArg("--group");
const artifactDir = readArg("--artifact-dir");
if (!groupName || !artifactDir) {
  throw new Error(
    "Usage: node scripts/ci/stage-build-artifact.mjs --group <name> --artifact-dir <dir>",
  );
}

const manifest = stageBuildArtifact({
  repoRoot: REPO_ROOT,
  artifactDir: resolve(REPO_ROOT, artifactDir),
  groupName,
  gitSha: process.env["GITHUB_SHA"] ?? "",
  runnerOs: process.env["RUNNER_OS"] ?? process.platform,
  nodeVersion: process.version,
});

console.log(`Staged ${manifest.outputs.length} output(s) for ${manifest.group} at ${artifactDir}`);
