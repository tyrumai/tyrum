import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  LiveBenchmarkSuiteSpec,
  type LiveBenchmarkSuiteSpec as LiveBenchmarkSuiteSpecT,
} from "@tyrum/contracts";

function formatZodError(error: {
  issues?: Array<{ path?: PropertyKey[]; message?: string }>;
}): string {
  const issues = error.issues ?? [];
  if (issues.length === 0) {
    return "invalid benchmark suite";
  }

  return issues
    .map((issue) => {
      const path = issue.path?.length ? issue.path.join(".") : "suite";
      return `${path}: ${issue.message ?? "invalid value"}`;
    })
    .join("; ");
}

export async function loadBenchmarkSuiteFromFile(path: string): Promise<{
  path: string;
  suite: LiveBenchmarkSuiteSpecT;
}> {
  const resolvedPath = resolve(path);
  const raw = await readFile(resolvedPath, "utf8");

  let parsed: unknown;
  try {
    parsed = parseYaml(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to parse benchmark suite YAML: ${message}`);
  }

  const validated = LiveBenchmarkSuiteSpec.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`invalid benchmark suite: ${formatZodError(validated.error)}`);
  }

  return {
    path: resolvedPath,
    suite: validated.data,
  };
}
