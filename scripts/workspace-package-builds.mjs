import { resolve } from "node:path";

export const PACKAGE_BUILD_SPECS = [
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
    key: "transport-sdk",
    name: "@tyrum/transport-sdk",
    dependencies: ["contracts"],
    inputPaths: [
      "packages/transport-sdk/package.json",
      "packages/transport-sdk/tsconfig.json",
      "packages/transport-sdk/src",
      "packages/transport-sdk/scripts",
    ],
    outputPaths: ["packages/transport-sdk/dist/index.mjs"],
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
    outputPaths: ["packages/node-sdk/dist/index.mjs"],
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
    outputPaths: ["packages/operator-app/dist/index.mjs"],
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
    outputPaths: ["packages/operator-ui/dist/index.mjs", "packages/operator-ui/dist/index.d.mts"],
  },
];

export function createPackageBuilds(repoRoot) {
  const outputsByKey = new Map(
    PACKAGE_BUILD_SPECS.map((spec) => [
      spec.key,
      spec.outputPaths.map((outputPath) => resolve(repoRoot, outputPath)),
    ]),
  );

  return PACKAGE_BUILD_SPECS.map((spec) => ({
    name: spec.name,
    inputs: [
      ...spec.inputPaths.map((inputPath) => resolve(repoRoot, inputPath)),
      ...(spec.dependencies ?? []).flatMap((dependency) => {
        const outputs = outputsByKey.get(dependency);
        if (!outputs) {
          throw new Error(`Unknown package build dependency: ${dependency}`);
        }
        return outputs;
      }),
    ],
    outputs: outputsByKey.get(spec.key) ?? [],
  }));
}
