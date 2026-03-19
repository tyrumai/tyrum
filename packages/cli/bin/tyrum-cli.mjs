#!/usr/bin/env node

import { runPackageBin } from "../../../scripts/package-bin-bootstrap.mjs";

await runPackageBin({
  metaUrl: import.meta.url,
  buildPackages: ["@tyrum/contracts", "@tyrum/transport-sdk", "@tyrum/cli"],
  dependencyEntrypoints: [
    "packages/contracts/dist/index.mjs",
    "packages/transport-sdk/dist/index.mjs",
  ],
});
