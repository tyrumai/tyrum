#!/usr/bin/env node

import { runPackageBin } from "../../../scripts/package-bin-bootstrap.mjs";

await runPackageBin({
  metaUrl: import.meta.url,
  buildPackages: ["@tyrum/schemas", "@tyrum/gateway"],
  dependencyEntrypoints: ["packages/schemas/dist/index.mjs"],
});
