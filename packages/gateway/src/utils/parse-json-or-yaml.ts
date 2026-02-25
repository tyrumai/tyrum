import { parse as parseYaml } from "yaml";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseJsonOrYaml(contents: string, hintPath?: string): unknown {
  const trimmed = contents.trim();
  if (trimmed.length === 0) return {};
  const isJson = hintPath?.toLowerCase().endsWith(".json") ?? trimmed.startsWith("{");
  if (isJson) return JSON.parse(trimmed) as unknown;
  return parseYaml(trimmed) as unknown;
}
