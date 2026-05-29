#!/usr/bin/env node

import { runPackageBin } from "../../../scripts/package-bin-bootstrap.mjs";

await runPackageBin({
  metaUrl: import.meta.url,
  buildPackages: [
    "@tyrum/contracts",
    "@tyrum/cli-utils",
    "@tyrum/runtime-policy",
    "@tyrum/runtime-node-control",
    "@tyrum/runtime-execution",
    "@tyrum/runtime-agent",
    "@tyrum/runtime-workboard",
    "@tyrum/gateway",
  ],
  dependencyEntrypoints: ["packages/contracts/dist/index.mjs"],
  dependencyBuildInputs: [
    {
      distEntrypoint: "packages/cli-utils/dist/index.mjs",
      srcRoot: "packages/cli-utils/src",
      watchedFiles: ["packages/cli-utils/package.json", "packages/cli-utils/tsconfig.json"],
    },
    {
      distEntrypoint: "packages/runtime-policy/dist/index.mjs",
      srcRoot: "packages/runtime-policy/src",
      watchedFiles: [
        "packages/runtime-policy/package.json",
        "packages/runtime-policy/tsconfig.json",
      ],
    },
    {
      distEntrypoint: "packages/runtime-node-control/dist/index.mjs",
      srcRoot: "packages/runtime-node-control/src",
      watchedFiles: [
        "packages/runtime-node-control/package.json",
        "packages/runtime-node-control/tsconfig.json",
      ],
    },
    {
      distEntrypoint: "packages/runtime-execution/dist/index.mjs",
      srcRoot: "packages/runtime-execution/src",
      watchedFiles: [
        "packages/runtime-execution/package.json",
        "packages/runtime-execution/tsconfig.json",
      ],
    },
    {
      distEntrypoint: "packages/runtime-agent/dist/index.mjs",
      srcRoot: "packages/runtime-agent/src",
      watchedFiles: ["packages/runtime-agent/package.json", "packages/runtime-agent/tsconfig.json"],
    },
    {
      distEntrypoint: "packages/runtime-workboard/dist/index.mjs",
      srcRoot: "packages/runtime-workboard/src",
      watchedFiles: [
        "packages/runtime-workboard/package.json",
        "packages/runtime-workboard/tsconfig.json",
      ],
    },
  ],
});
