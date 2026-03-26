#!/usr/bin/env node

import { runPackageBin } from "../../../scripts/package-bin-bootstrap.mjs";

await runPackageBin({
  metaUrl: import.meta.url,
  buildPackages: ["@tyrum/contracts", "@tyrum/runtime-execution", "@tyrum/gateway"],
  dependencyEntrypoints: ["packages/contracts/dist/index.mjs"],
  dependencyBuildInputs: [
    {
      distEntrypoint: "packages/runtime-execution/dist/index.mjs",
      srcRoot: "packages/runtime-execution/src",
      watchedFiles: [
        "packages/runtime-execution/package.json",
        "packages/runtime-execution/tsconfig.json",
      ],
    },
  ],
});
