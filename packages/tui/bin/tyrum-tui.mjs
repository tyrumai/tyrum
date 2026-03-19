#!/usr/bin/env node

import { runPackageBin } from "../../../scripts/package-bin-bootstrap.mjs";

await runPackageBin({
  metaUrl: import.meta.url,
  buildPackages: ["@tyrum/contracts", "@tyrum/client", "@tyrum/operator-core", "@tyrum/tui"],
  dependencyEntrypoints: [
    "packages/contracts/dist/index.mjs",
    "packages/client/dist/index.mjs",
    "packages/operator-core/dist/index.mjs",
  ],
  sourceExtensions: [".ts", ".tsx"],
});
