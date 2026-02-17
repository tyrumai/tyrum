import { parse as parseYaml } from "yaml";

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatterDocument(document: string): ParsedFrontmatter {
  const match = FRONTMATTER_REGEX.exec(document);
  if (!match) {
    return {
      frontmatter: {},
      body: document,
    };
  }

  const yamlBlock = match[1] ?? "";
  const body = match[2] ?? "";

  const parsed = parseYaml(yamlBlock);
  const frontmatter =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};

  return {
    frontmatter,
    body,
  };
}
