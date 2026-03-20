import { resolve } from "node:path";

// Every workspace tsconfig.json extends the repo-level compiler baseline.
const WORKSPACE_INPUT_PATHS = ["tsconfig.base.json"];

export function createBuildsFromSpecs(repoRoot, specs, dependencyLabel) {
  const workspaceInputs = WORKSPACE_INPUT_PATHS.map((inputPath) => resolve(repoRoot, inputPath));
  const outputsByKey = new Map(
    specs.map((spec) => [
      spec.key,
      spec.outputPaths.map((outputPath) => resolve(repoRoot, outputPath)),
    ]),
  );

  return specs.map((spec) => ({
    name: spec.name,
    inputs: [
      ...workspaceInputs,
      ...spec.inputPaths.map((inputPath) => resolve(repoRoot, inputPath)),
      ...(spec.dependencies ?? []).flatMap((dependency) => {
        const outputs = outputsByKey.get(dependency);
        if (!outputs) {
          throw new Error(`Unknown ${dependencyLabel}: ${dependency}`);
        }
        return outputs;
      }),
    ],
    outputs: outputsByKey.get(spec.key) ?? [],
  }));
}
