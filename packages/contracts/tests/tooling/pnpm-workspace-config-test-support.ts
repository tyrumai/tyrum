import { readFileSync } from "node:fs";

export function readWorkspaceConfigMap(path: string, section: string): Record<string, string> {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line === `${section}:`);

  if (startIndex < 0) {
    throw new Error(`Missing ${section} section in ${path}`);
  }

  const entries: Record<string, string> = {};
  for (const line of lines.slice(startIndex + 1)) {
    if (isTopLevelYamlKey(line)) break;

    const entry = parseIndentedScalarMapEntry(line);
    if (entry) entries[entry.key] = entry.value;
  }

  return entries;
}

function isTopLevelYamlKey(line: string): boolean {
  return /^[A-Za-z0-9_-]+:/.test(line);
}

function parseIndentedScalarMapEntry(line: string): { key: string; value: string } | undefined {
  if (!line.startsWith("  ") || line.startsWith("    ")) return undefined;

  const trimmed = line.slice(2).trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) return undefined;

  const separatorIndex = findYamlKeySeparator(trimmed);
  if (separatorIndex < 0) return undefined;

  const rawValue = trimmed.slice(separatorIndex + 1).trim();
  if (rawValue.length === 0) return undefined;

  return {
    key: unquoteYamlScalar(trimmed.slice(0, separatorIndex).trim()),
    value: unquoteYamlScalar(rawValue),
  };
}

function findYamlKeySeparator(value: string): number {
  let quotedBy: '"' | "'" | undefined;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if ((char === '"' || char === "'") && value[index - 1] !== "\\") {
      quotedBy = quotedBy === char ? undefined : (quotedBy ?? char);
      continue;
    }

    if (char === ":" && quotedBy === undefined) return index;
  }

  return -1;
}

function unquoteYamlScalar(value: string): string {
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value.at(-1) !== quote) return value;

  return value.slice(1, -1).replaceAll(`\\${quote}`, quote);
}
