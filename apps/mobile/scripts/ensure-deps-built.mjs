import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuildsFresh } from "../../../scripts/workspace-build-freshness.mjs";
import { createPackageBuilds } from "../../../scripts/workspace-package-builds.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(APP_ROOT, "../..");

ensureBuildsFresh(REPO_ROOT, createPackageBuilds(REPO_ROOT));
