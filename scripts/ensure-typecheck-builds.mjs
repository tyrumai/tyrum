import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuildsFresh } from "./workspace-build-freshness.mjs";
import { createWorkspaceTypecheckBuilds } from "./workspace-typecheck-builds.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

ensureBuildsFresh(REPO_ROOT, createWorkspaceTypecheckBuilds(REPO_ROOT));
