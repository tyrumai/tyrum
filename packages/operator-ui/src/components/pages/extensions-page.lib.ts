import type { ManagedExtensionSummary } from "@tyrum/schemas";

export type ExtensionKind = "skill" | "mcp";
export type ExtensionsTab = "skills" | "mcp";
export type ExtensionsByTab = Record<ExtensionsTab, ManagedExtensionSummary[]>;

export const EMPTY_EXTENSIONS_BY_TAB: ExtensionsByTab = {
  skills: [],
  mcp: [],
};

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function encodeFileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function tabToKind(tab: ExtensionsTab): ExtensionKind {
  return tab === "skills" ? "skill" : "mcp";
}

export function kindToTab(kind: ExtensionKind): ExtensionsTab {
  return kind === "skill" ? "skills" : "mcp";
}

export function sortExtensions(items: ManagedExtensionSummary[]): ManagedExtensionSummary[] {
  return [...items].toSorted((left, right) => left.name.localeCompare(right.name));
}
