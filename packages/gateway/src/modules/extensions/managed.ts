import { Buffer } from "node:buffer";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix as pathPosix } from "node:path";
import {
  ManagedBundleFile,
  ManagedMcpPackage,
  ManagedSkillPackage,
  McpServerSpec,
  SkillManifest,
  type ManagedMcpPackage as ManagedMcpPackageT,
  type ManagedSkillPackage as ManagedSkillPackageT,
  type McpServerSpec as McpServerSpecT,
  type SkillManifest as SkillManifestT,
} from "@tyrum/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parseFrontmatterDocument } from "../agent/frontmatter.js";
import type { RuntimePackageKind, RuntimePackageRevision } from "../agent/runtime-package-dal.js";

const DEFAULT_SKILL_VERSION = "1.0.0";

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeExtensionKey(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const slug = slugify(candidate ?? "");
    if (slug) return slug;
  }
  throw new Error("extension key is required");
}

function normalizeRelativePath(rawPath: string): string {
  const normalized = pathPosix.normalize(rawPath.replaceAll("\\", "/")).replace(/^\/+/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`invalid bundle path '${rawPath}'`);
  }
  return normalized;
}

function toBundleFiles(files: readonly { path: string; content: Buffer }[]) {
  return files.map((file) =>
    ManagedBundleFile.parse({
      path: normalizeRelativePath(file.path),
      content_base64: file.content.toString("base64"),
    }),
  );
}

function fileMapFromBundle(
  files: readonly { path: string; content: Buffer }[],
): Map<string, Buffer> {
  return new Map(files.map((file) => [normalizeRelativePath(file.path), file.content]));
}

function parseSkillMarkdown(markdown: string, keyHint?: string): SkillManifestT {
  const parsed = parseFrontmatterDocument(markdown);
  const frontmatter = { ...parsed.frontmatter };
  const normalizedKey = normalizeExtensionKey(
    keyHint,
    typeof frontmatter["id"] === "string" ? frontmatter["id"] : undefined,
    typeof frontmatter["name"] === "string" ? frontmatter["name"] : undefined,
  );
  if (typeof frontmatter["id"] !== "string" || frontmatter["id"].trim().length === 0) {
    frontmatter["id"] = normalizedKey;
  }
  if (typeof frontmatter["version"] !== "string" || frontmatter["version"].trim().length === 0) {
    frontmatter["version"] = DEFAULT_SKILL_VERSION;
  }

  return SkillManifest.parse({
    meta: frontmatter,
    body: parsed.body.trim(),
  });
}

function readYamlObject(raw: string): Record<string, unknown> {
  const parsed = parseYaml(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("YAML file must contain an object");
  }
  return parsed as Record<string, unknown>;
}

function findBundleFile(
  files: Map<string, Buffer>,
  basename: string,
): { path: string; content: Buffer } | undefined {
  for (const [path, content] of files) {
    if (path.split("/").at(-1) === basename) {
      return { path, content };
    }
  }
  return undefined;
}

export function buildManagedSkillPackageFromMarkdown(input: {
  key?: string;
  markdown: string;
  source: ManagedSkillPackageT["source"];
}): ManagedSkillPackageT {
  const manifest = parseSkillMarkdown(input.markdown, input.key);
  const key = normalizeExtensionKey(input.key, manifest.meta.id, manifest.meta.name);
  return ManagedSkillPackage.parse({
    format: "agent-skill-bundle",
    key,
    manifest,
    files: [
      {
        path: "SKILL.md",
        content_base64: Buffer.from(input.markdown, "utf-8").toString("base64"),
      },
    ],
    source: input.source,
  });
}

export function buildManagedSkillPackageFromFiles(input: {
  key?: string;
  files: readonly { path: string; content: Buffer }[];
  source: ManagedSkillPackageT["source"];
}): ManagedSkillPackageT {
  const filesByPath = fileMapFromBundle(input.files);
  const skillFile = findBundleFile(filesByPath, "SKILL.md");
  if (!skillFile) {
    throw new Error("skill bundle is missing SKILL.md");
  }
  const manifest = parseSkillMarkdown(skillFile.content.toString("utf-8"), input.key);
  const key = normalizeExtensionKey(input.key, manifest.meta.id, manifest.meta.name);
  return ManagedSkillPackage.parse({
    format: "agent-skill-bundle",
    key,
    manifest,
    files: toBundleFiles(input.files),
    source: input.source,
  });
}

function normalizeMcpSpec(spec: McpServerSpecT, key: string): McpServerSpecT {
  return spec.id === key ? spec : { ...spec, id: key };
}

export function buildManagedMcpPackageFromSpec(input: {
  key?: string;
  spec: McpServerSpecT;
  files?: readonly { path: string; content: Buffer }[];
  source: ManagedMcpPackageT["source"];
}): ManagedMcpPackageT {
  const key = normalizeExtensionKey(input.key, input.spec.id, input.spec.name);
  return ManagedMcpPackage.parse({
    format: "mcp-package",
    key,
    spec: normalizeMcpSpec(input.spec, key),
    files: toBundleFiles(input.files ?? []),
    source: input.source,
  });
}

export function buildManagedMcpPackageFromFiles(input: {
  key?: string;
  files: readonly { path: string; content: Buffer }[];
  source: ManagedMcpPackageT["source"];
}): ManagedMcpPackageT {
  const filesByPath = fileMapFromBundle(input.files);
  const specFile = findBundleFile(filesByPath, "server.yml");
  if (!specFile) {
    throw new Error("MCP bundle is missing server.yml");
  }
  const rawSpec = McpServerSpec.parse(readYamlObject(specFile.content.toString("utf-8")));
  return buildManagedMcpPackageFromSpec({
    key: input.key,
    spec: rawSpec,
    files: input.files,
    source: input.source,
  });
}

export function parseManagedSkillPackage(
  value: unknown,
  fallbackKey?: string,
): ManagedSkillPackageT {
  const parsed = ManagedSkillPackage.safeParse(value);
  if (parsed.success) return parsed.data;

  const legacy = SkillManifest.safeParse(value);
  if (!legacy.success) {
    throw new Error(parsed.error.message);
  }
  const key = normalizeExtensionKey(fallbackKey, legacy.data.meta.id, legacy.data.meta.name);
  const markdown = renderSkillMarkdown(legacy.data);
  return buildManagedSkillPackageFromMarkdown({
    key,
    markdown,
    source: {
      kind: "upload",
      filename: "SKILL.md",
      content_type: "text/markdown",
    },
  });
}

export function parseManagedMcpPackage(value: unknown, fallbackKey?: string): ManagedMcpPackageT {
  const parsed = ManagedMcpPackage.safeParse(value);
  if (parsed.success) return parsed.data;

  const legacy = McpServerSpec.safeParse(value);
  if (!legacy.success) {
    throw new Error(parsed.error.message);
  }
  const key = normalizeExtensionKey(fallbackKey, legacy.data.id, legacy.data.name);
  return buildManagedMcpPackageFromSpec({
    key,
    spec: legacy.data,
    source: {
      kind: "upload",
      filename: "server.yml",
      content_type: "application/yaml",
    },
  });
}

function renderSkillMarkdown(manifest: SkillManifestT): string {
  const frontmatter = stringifyYaml(manifest.meta).trimEnd();
  const body = manifest.body.trim();
  return `---\n${frontmatter}\n---\n${body}\n`;
}

function resolveManagedRoot(params: {
  home: string;
  tenantId: string;
  stateMode: "local" | "shared";
  kind: "skill" | "mcp";
}): string {
  if (params.stateMode === "shared") {
    return join(
      params.home,
      "managed",
      "tenants",
      params.tenantId,
      params.kind === "skill" ? "skills" : "mcp",
    );
  }
  return join(params.home, "managed", params.kind === "skill" ? "skills" : "mcp");
}

export function resolveManagedPackageDir(params: {
  home: string;
  tenantId: string;
  stateMode: "local" | "shared";
  kind: "skill" | "mcp";
  key: string;
}): string {
  return join(resolveManagedRoot(params), normalizeExtensionKey(params.key));
}

export function resolveMaterializedEntryPath(params: {
  home: string;
  tenantId: string;
  stateMode: "local" | "shared";
  kind: "skill" | "mcp";
  key: string;
}): string {
  const base = resolveManagedPackageDir(params);
  return join(base, params.kind === "skill" ? "SKILL.md" : "server.yml");
}

async function writeBundleFiles(
  baseDir: string,
  files: readonly { path: string; content: Buffer }[],
): Promise<void> {
  for (const file of files) {
    const relativePath = normalizeRelativePath(file.path);
    const targetPath = join(baseDir, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.content);
  }
}

export async function materializeManagedSkillPackage(params: {
  home: string;
  tenantId: string;
  stateMode: "local" | "shared";
  pkg: ManagedSkillPackageT;
}): Promise<string> {
  const targetDir = resolveManagedPackageDir({
    home: params.home,
    tenantId: params.tenantId,
    stateMode: params.stateMode,
    kind: "skill",
    key: params.pkg.key,
  });
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await writeBundleFiles(
    targetDir,
    params.pkg.files.map((file) => ({
      path: file.path,
      content: Buffer.from(file.content_base64, "base64"),
    })),
  );
  return join(targetDir, "SKILL.md");
}

export async function materializeManagedMcpPackage(params: {
  home: string;
  tenantId: string;
  stateMode: "local" | "shared";
  pkg: ManagedMcpPackageT;
}): Promise<string> {
  const targetDir = resolveManagedPackageDir({
    home: params.home,
    tenantId: params.tenantId,
    stateMode: params.stateMode,
    kind: "mcp",
    key: params.pkg.key,
  });
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  const bundleFiles = params.pkg.files.map((file) => ({
    path: file.path,
    content: Buffer.from(file.content_base64, "base64"),
  }));
  await writeBundleFiles(targetDir, bundleFiles);
  const serverPath = join(targetDir, "server.yml");
  const hasServerFile = bundleFiles.some(
    (file) => normalizeRelativePath(file.path) === "server.yml",
  );
  if (!hasServerFile) {
    await writeFile(serverPath, stringifyYaml(params.pkg.spec), "utf-8");
  }
  return serverPath;
}

export async function ensureManagedExtensionMaterialized(params: {
  home: string;
  tenantId: string;
  stateMode: "local" | "shared";
  kind: RuntimePackageKind;
  revision: RuntimePackageRevision;
}): Promise<string | undefined> {
  if (params.kind === "skill") {
    const pkg = parseManagedSkillPackage(params.revision.packageData, params.revision.packageKey);
    return await materializeManagedSkillPackage({
      home: params.home,
      tenantId: params.tenantId,
      stateMode: params.stateMode,
      pkg,
    });
  }
  if (params.kind === "mcp") {
    const pkg = parseManagedMcpPackage(params.revision.packageData, params.revision.packageKey);
    return await materializeManagedMcpPackage({
      home: params.home,
      tenantId: params.tenantId,
      stateMode: params.stateMode,
      pkg,
    });
  }
  return undefined;
}
