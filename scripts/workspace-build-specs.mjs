import { resolve } from "node:path";

export function createBuildsFromSpecs(repoRoot, specs, dependencyLabel) {
  const outputsByKey = new Map(
    specs.map((spec) => [
      spec.key,
      spec.outputPaths.map((outputPath) => resolve(repoRoot, outputPath)),
    ]),
  );

  return specs.map((spec) => ({
    name: spec.name,
    inputs: [
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
