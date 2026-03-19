#!/usr/bin/env node

import { runPackageBin } from "../../../scripts/package-bin-bootstrap.mjs";

await runPackageBin({
  metaUrl: import.meta.url,
  buildPackages: [
    "@tyrum/contracts",
    "@tyrum/transport-sdk",
    "@tyrum/node-sdk",
    "@tyrum/desktop-node",
  ],
  dependencyEntrypoints: [
    "packages/contracts/dist/index.mjs",
    "packages/transport-sdk/dist/index.mjs",
    "packages/node-sdk/dist/index.mjs",
  ],
  sourceExtensions: [".ts", ".tsx"],
});
