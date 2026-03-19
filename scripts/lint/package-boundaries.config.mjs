/**
 * Executable subset of the clean-break target-state package graph from:
 * - docs/architecture/target-state.md
 * - docs/architecture/reference/arch-01-clean-break-target-state.md
 *
 * Keep this file in sync with those docs and update the temporary coexistence
 * baseline in package-boundaries-baseline.json in the same PR when a new target
 * package lands.
 */

export const PACKAGE_BOUNDARY_RULES = Object.freeze({
  targetPackages: Object.freeze({
    "@tyrum/contracts": [],
    "@tyrum/transport-sdk": ["@tyrum/contracts"],
    "@tyrum/node-sdk": ["@tyrum/contracts", "@tyrum/transport-sdk"],
    "@tyrum/operator-app": ["@tyrum/contracts", "@tyrum/transport-sdk"],
    "@tyrum/operator-ui": ["@tyrum/operator-app"],
    "@tyrum/runtime-policy": ["@tyrum/contracts"],
    "@tyrum/runtime-node-control": ["@tyrum/contracts", "@tyrum/runtime-policy"],
    "@tyrum/runtime-execution": [
      "@tyrum/contracts",
      "@tyrum/runtime-policy",
      "@tyrum/runtime-node-control",
    ],
    "@tyrum/runtime-agent": ["@tyrum/contracts", "@tyrum/runtime-execution"],
    "@tyrum/runtime-workboard": [
      "@tyrum/contracts",
      "@tyrum/runtime-agent",
      "@tyrum/runtime-execution",
    ],
    "@tyrum/gateway": [
      "@tyrum/contracts",
      "@tyrum/transport-sdk",
      "@tyrum/node-sdk",
      "@tyrum/operator-app",
      "@tyrum/operator-ui",
      "@tyrum/runtime-policy",
      "@tyrum/runtime-node-control",
      "@tyrum/runtime-execution",
      "@tyrum/runtime-agent",
      "@tyrum/runtime-workboard",
    ],
  }),
  legacyPackages: Object.freeze({
    "@tyrum/client": {
      activation: "all",
      replacementPackages: ["@tyrum/transport-sdk", "@tyrum/node-sdk"],
    },
    "@tyrum/operator-core": {
      activation: "all",
      replacementPackages: ["@tyrum/operator-app"],
    },
  }),
});
