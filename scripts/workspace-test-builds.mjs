import { createBuildsFromSpecs } from "./workspace-build-specs.mjs";

export const WORKSPACE_TEST_BUILD_SPECS = [
  {
    key: "contracts",
    name: "@tyrum/contracts",
    inputPaths: [
      "packages/contracts/package.json",
      "packages/contracts/tsconfig.json",
      "packages/contracts/src",
      "packages/contracts/scripts",
    ],
    outputPaths: [
      "packages/contracts/dist/index.mjs",
      "packages/contracts/dist/index.d.ts",
      "packages/contracts/dist/jsonschema/catalog.json",
    ],
  },
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
  {
    key: "transport-sdk",
    name: "@tyrum/transport-sdk",
    dependencies: ["contracts"],
    inputPaths: [
      "packages/transport-sdk/package.json",
      "packages/transport-sdk/tsconfig.json",
      "packages/transport-sdk/src",
      "packages/transport-sdk/scripts",
    ],
    outputPaths: [
      "packages/transport-sdk/dist/index.mjs",
      "packages/transport-sdk/dist/browser.mjs",
      "packages/transport-sdk/dist/node.mjs",
      "packages/transport-sdk/dist/node/pinned-transport.js",
    ],
  },
  {
    key: "node-sdk",
    name: "@tyrum/node-sdk",
    dependencies: ["contracts", "transport-sdk"],
    inputPaths: [
      "packages/node-sdk/package.json",
      "packages/node-sdk/tsconfig.json",
      "packages/node-sdk/src",
    ],
    outputPaths: [
      "packages/node-sdk/dist/index.mjs",
      "packages/node-sdk/dist/browser.mjs",
      "packages/node-sdk/dist/node.mjs",
    ],
  },
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
  {
    key: "operator-app",
    name: "@tyrum/operator-app",
    dependencies: ["contracts", "transport-sdk"],
    inputPaths: [
      "packages/operator-app/package.json",
      "packages/operator-app/tsconfig.json",
      "packages/operator-app/src",
    ],
    outputPaths: [
      "packages/operator-app/dist/index.mjs",
      "packages/operator-app/dist/browser.mjs",
      "packages/operator-app/dist/node.mjs",
    ],
  },
  {
    key: "operator-ui",
    name: "@tyrum/operator-ui",
    dependencies: ["contracts", "operator-app"],
    inputPaths: [
      "packages/operator-ui/package.json",
      "packages/operator-ui/tsconfig.json",
      "packages/operator-ui/src",
    ],
    outputPaths: [
      "packages/operator-ui/dist/index.mjs",
      "packages/operator-ui/dist/index.d.mts",
      "packages/operator-ui/dist/pages.mjs",
      "packages/operator-ui/dist/pages.d.mts",
    ],
  },
  {
    key: "gateway",
    name: "@tyrum/gateway",
    dependencies: [
      "cli-utils",
      "contracts",
      "node-sdk",
      "operator-app",
      "operator-ui",
      "runtime-agent",
      "runtime-execution",
      "runtime-node-control",
      "runtime-policy",
      "runtime-workboard",
      "transport-sdk",
    ],
    inputPaths: [
      "packages/gateway/package.json",
      "packages/gateway/tsconfig.json",
      "packages/gateway/src",
      "packages/gateway/scripts",
      "apps/web/package.json",
      "apps/web/vite.config.ts",
      "apps/web/public",
      "apps/web/src",
    ],
    outputPaths: [
      "packages/gateway/dist/index.mjs",
      "packages/gateway/dist/index.d.mts",
      "packages/gateway/dist/ui/index.html",
      "apps/web/dist/index.html",
    ],
  },
];

export function createWorkspaceTestBuilds(repoRoot) {
  return createBuildsFromSpecs(
    repoRoot,
    WORKSPACE_TEST_BUILD_SPECS,
    "workspace test build dependency",
  );
}
