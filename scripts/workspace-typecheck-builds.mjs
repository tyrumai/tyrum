import { createBuildsFromSpecs } from "./workspace-build-specs.mjs";
import { PACKAGE_BUILD_SPECS } from "./workspace-package-builds.mjs";

function createPackageDerivedSpec(key, outputPaths) {
  const spec = PACKAGE_BUILD_SPECS.find((candidate) => candidate.key === key);
  if (!spec) {
    throw new Error(`Unknown package build spec: ${key}`);
  }

  return {
    ...spec,
    inputPaths: [...spec.inputPaths],
    ...(spec.dependencies ? { dependencies: [...spec.dependencies] } : {}),
    outputPaths: [...(outputPaths ?? spec.outputPaths)],
  };
}

export const WORKSPACE_TYPECHECK_BUILD_SPECS = [
  createPackageDerivedSpec("contracts"),
  {
    key: "runtime-policy",
    name: "@tyrum/runtime-policy",
    dependencies: ["contracts"],
    inputPaths: [
      "packages/runtime-policy/package.json",
      "packages/runtime-policy/tsconfig.json",
      "packages/runtime-policy/src",
    ],
    outputPaths: ["packages/runtime-policy/dist/index.mjs"],
  },
  createPackageDerivedSpec("transport-sdk", [
    "packages/transport-sdk/dist/index.mjs",
    "packages/transport-sdk/dist/browser.mjs",
    "packages/transport-sdk/dist/node.mjs",
    "packages/transport-sdk/dist/node/pinned-transport.js",
  ]),
  createPackageDerivedSpec("node-sdk", [
    "packages/node-sdk/dist/index.mjs",
    "packages/node-sdk/dist/browser.mjs",
    "packages/node-sdk/dist/node.mjs",
  ]),
  {
    key: "runtime-node-control",
    name: "@tyrum/runtime-node-control",
    dependencies: ["contracts"],
    inputPaths: [
      "packages/runtime-node-control/package.json",
      "packages/runtime-node-control/tsconfig.json",
      "packages/runtime-node-control/src",
    ],
    outputPaths: ["packages/runtime-node-control/dist/index.mjs"],
  },
  {
    key: "runtime-execution",
    name: "@tyrum/runtime-execution",
    dependencies: ["contracts"],
    inputPaths: [
      "packages/runtime-execution/package.json",
      "packages/runtime-execution/tsconfig.json",
      "packages/runtime-execution/src",
    ],
    outputPaths: ["packages/runtime-execution/dist/index.mjs"],
  },
  {
    key: "runtime-agent",
    name: "@tyrum/runtime-agent",
    dependencies: ["contracts"],
    inputPaths: [
      "packages/runtime-agent/package.json",
      "packages/runtime-agent/tsconfig.json",
      "packages/runtime-agent/src",
    ],
    outputPaths: ["packages/runtime-agent/dist/index.mjs"],
  },
  {
    key: "runtime-workboard",
    name: "@tyrum/runtime-workboard",
    dependencies: ["contracts"],
    inputPaths: [
      "packages/runtime-workboard/package.json",
      "packages/runtime-workboard/tsconfig.json",
      "packages/runtime-workboard/src",
    ],
    outputPaths: ["packages/runtime-workboard/dist/index.mjs"],
  },
  {
    key: "cli-utils",
    name: "@tyrum/cli-utils",
    inputPaths: [
      "packages/cli-utils/package.json",
      "packages/cli-utils/tsconfig.json",
      "packages/cli-utils/src",
    ],
    outputPaths: ["packages/cli-utils/dist/index.mjs"],
  },
  {
    key: "desktop-node",
    name: "@tyrum/desktop-node",
    dependencies: ["cli-utils", "contracts", "node-sdk"],
    inputPaths: [
      "packages/desktop-node/package.json",
      "packages/desktop-node/tsconfig.json",
      "packages/desktop-node/tsdown.config.ts",
      "packages/desktop-node/src",
    ],
    outputPaths: ["packages/desktop-node/dist/index.mjs"],
  },
  createPackageDerivedSpec("operator-app", [
    "packages/operator-app/dist/index.mjs",
    "packages/operator-app/dist/browser.mjs",
    "packages/operator-app/dist/node.mjs",
  ]),
  createPackageDerivedSpec("operator-ui", [
    "packages/operator-ui/dist/index.mjs",
    "packages/operator-ui/dist/index.d.mts",
    "packages/operator-ui/dist/pages.mjs",
    "packages/operator-ui/dist/pages.d.mts",
  ]),
];

export function createWorkspaceTypecheckBuilds(repoRoot) {
  return createBuildsFromSpecs(
    repoRoot,
    WORKSPACE_TYPECHECK_BUILD_SPECS,
    "workspace typecheck build dependency",
  );
}
