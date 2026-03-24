import { createBuildsFromSpecs } from "./workspace-build-specs.mjs";
import { WORKSPACE_TEST_BUILD_SPECS } from "./workspace-test-builds.mjs";

// Typecheck freshness uses the same package build graph as tests, minus the
// gateway/web bundle step that is only needed for test execution.
export const WORKSPACE_TYPECHECK_BUILD_SPECS = WORKSPACE_TEST_BUILD_SPECS.filter(
  (spec) => spec.key !== "gateway",
);

export function createWorkspaceTypecheckBuilds(repoRoot) {
  return createBuildsFromSpecs(
    repoRoot,
    WORKSPACE_TYPECHECK_BUILD_SPECS,
    "workspace typecheck build dependency",
  );
}
