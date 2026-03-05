import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRootDir = resolve(scriptDir, "../../..");
const repoDocsDir = resolve(repoRootDir, "docs");
const buildDir = resolve(scriptDir, "..", "build");
const outDocsDir = resolve(buildDir, "docs");

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

function toUrlPath(filePath) {
  return filePath.split(/[/\\\\]/).join("/");
}

function docUrl(baseUrl, relativeFilePath) {
  return `${baseUrl}/docs/${toUrlPath(relativeFilePath)}`;
}

async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
      continue;
    }
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function sortPaths(paths) {
  return paths.toSorted((a, b) => a.localeCompare(b));
}

function addSection(lines, header, urls) {
  if (urls.length === 0) return;
  lines.push(`## ${header}`);
  lines.push("");
  for (const url of urls) lines.push(`- ${url}`);
  lines.push("");
}

async function main() {
  await stat(repoDocsDir);
  await stat(buildDir);

  await rm(outDocsDir, { recursive: true, force: true });
  await mkdir(outDocsDir, { recursive: true });
  await cp(repoDocsDir, outDocsDir, { recursive: true });

  const baseUrl = normalizeBaseUrl(
    process.env.CF_PAGES_URL ?? process.env.DOCS_BASE_URL ?? "https://docs.tyrum.ai",
  );

  const repoDocFiles = await walkFiles(repoDocsDir);
  const markdownFiles = sortPaths(
    repoDocFiles
      .map((fullPath) => relative(repoDocsDir, fullPath))
      .filter((relPath) => [".md", ".mdx"].includes(extname(relPath))),
  );

  const remaining = new Set(markdownFiles);
  const takeExact = (relPath) => {
    if (!remaining.has(relPath)) return null;
    remaining.delete(relPath);
    return relPath;
  };

  const getStartedFiles = ["index.md", "install.md", "getting-started.md"]
    .map(takeExact)
    .filter(Boolean);

  const advancedFiles = sortPaths(
    [...remaining].filter((relPath) => relPath.startsWith("advanced/")),
  );
  for (const relPath of advancedFiles) remaining.delete(relPath);

  const referenceFiles = [];
  const policyService = takeExact("policy_service.md");
  if (policyService) referenceFiles.push(policyService);

  const executorFiles = sortPaths(
    [...remaining].filter((relPath) => relPath.startsWith("executors/")),
  );
  for (const relPath of executorFiles) remaining.delete(relPath);
  referenceFiles.push(...executorFiles);

  const architectureIndex = takeExact("architecture/index.md");
  const protocolIndex = takeExact("architecture/protocol/index.md");
  const protocolChildren = sortPaths(
    [...remaining].filter((relPath) => relPath.startsWith("architecture/protocol/")),
  );
  for (const relPath of protocolChildren) remaining.delete(relPath);

  const architectureOther = sortPaths(
    [...remaining].filter((relPath) => relPath.startsWith("architecture/")),
  );
  for (const relPath of architectureOther) remaining.delete(relPath);

  const metaFiles = ["_README.md"].map(takeExact).filter(Boolean);

  const otherFiles = sortPaths([...remaining]);

  const lines = ["# Tyrum Documentation", ""];

  addSection(
    lines,
    "Get Started",
    getStartedFiles.map((relPath) => docUrl(baseUrl, relPath)),
  );

  addSection(
    lines,
    "Advanced",
    advancedFiles.map((relPath) => docUrl(baseUrl, relPath)),
  );

  addSection(
    lines,
    "Reference",
    referenceFiles.map((relPath) => docUrl(baseUrl, relPath)),
  );

  if (
    architectureIndex ||
    protocolIndex ||
    protocolChildren.length > 0 ||
    architectureOther.length > 0
  ) {
    lines.push("## Architecture");
    lines.push("");

    if (architectureIndex) lines.push(`- ${docUrl(baseUrl, architectureIndex)}`);

    if (protocolIndex) {
      lines.push(`- ${docUrl(baseUrl, protocolIndex)}`);
      for (const relPath of protocolChildren) {
        lines.push(`  - ${docUrl(baseUrl, relPath)}`);
      }
    } else {
      for (const relPath of protocolChildren) {
        lines.push(`- ${docUrl(baseUrl, relPath)}`);
      }
    }

    for (const relPath of architectureOther) {
      lines.push(`- ${docUrl(baseUrl, relPath)}`);
    }
    lines.push("");
  }

  addSection(
    lines,
    "Meta",
    metaFiles.map((relPath) => docUrl(baseUrl, relPath)),
  );

  addSection(
    lines,
    "Other",
    otherFiles.map((relPath) => docUrl(baseUrl, relPath)),
  );

  await writeFile(resolve(buildDir, "llms.txt"), `${lines.join("\n")}\n`, "utf8");
}

await main();
