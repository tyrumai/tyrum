import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { restoreBuildArtifact } from "./build-artifacts-lib.mjs";

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
    "Usage: node scripts/ci/restore-build-artifact.mjs --group <name> --artifact-dir <dir>",
  );
}

const manifest = restoreBuildArtifact({
  repoRoot: REPO_ROOT,
  artifactDir: resolve(REPO_ROOT, artifactDir),
  expectedGroupName: groupName,
  expectedGitSha: process.env["GITHUB_SHA"] ?? "",
  expectedRunnerOs: process.env["RUNNER_OS"] ?? process.platform,
  expectedNodeVersion: process.version,
});

console.log(
  `Restored ${manifest.outputs.length} output(s) for ${manifest.group} from ${artifactDir}`,
);
