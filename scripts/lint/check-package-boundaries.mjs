#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGE_BOUNDARY_RULES } from "./package-boundaries.config.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const baselinePath = path.join(scriptDir, "package-boundaries-baseline.json");

const PACKAGE_GROUPS = ["packages", "apps"];
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const SOURCE_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const SKIP_DIR_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "release",
]);
const LOCAL_MODULE_RESOLUTION_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];
const MODULE_SPECIFIER_PATTERNS = [
  /\bimport\s+[\s\S]*?\sfrom\s*["'`]([^"'`]+)["'`]/gm,
  /\bexport\s+[\s\S]*?\sfrom\s*["'`]([^"'`]+)["'`]/gm,
  /\bimport\s*["'`]([^"'`]+)["'`]/gm,
  /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/gm,
  /\brequire\(\s*["'`]([^"'`]+)["'`]\s*\)/gm,
];

/**
 * @typedef {{
 *   allowedImportEdges?: Array<{ fromFile: string; reason?: string; toPackage: string }>;
 *   allowedManifestEdges?: Array<{ fromPackage: string; reason?: string; toPackage: string }>;
 * }} BoundaryBaseline
 */

/**
 * @typedef {{
 *   fromFile?: string;
 *   fromPackage: string;
 *   kind:
 *     | "forbidden-target-import-edge"
 *     | "forbidden-target-manifest-edge"
 *     | "forbidden-gateway-entrypoint-import-edge"
 *     | "legacy-import-edge"
 *     | "legacy-manifest-edge";
 *   manifestPath?: string;
 *   replacementPackages?: string[];
 *   toFile?: string;
 *   toPackage: string;
 * }} BoundaryViolation
 */

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function listWorkspacePackageJsonPaths(rootDir) {
  const packageJsonPaths = [];

  for (const group of PACKAGE_GROUPS) {
    const groupDir = path.join(rootDir, group);
    if (!existsSync(groupDir)) continue;

    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const packageJsonPath = path.join(groupDir, entry.name, "package.json");
      if (existsSync(packageJsonPath)) packageJsonPaths.push(packageJsonPath);
    }
  }

  return packageJsonPaths.toSorted();
}

function loadWorkspacePackages(rootDir) {
  return listWorkspacePackageJsonPaths(rootDir).map((packageJsonPath) => {
    const manifest = readJson(packageJsonPath);
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new Error(`Invalid package.json: ${packageJsonPath}`);
    }

    if (typeof manifest.name !== "string" || manifest.name.length === 0) {
      throw new Error(`Missing workspace package name in ${packageJsonPath}`);
    }

    const packageDir = path.dirname(packageJsonPath);
    return {
      manifest,
      manifestPath: path.relative(rootDir, packageJsonPath).replaceAll("\\", "/"),
      name: manifest.name,
      packageDir,
    };
  });
}

function normalizeBaselineEntry(entry, expectedKeys, label) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${label} entries must be objects`);
  }

  for (const key of expectedKeys) {
    if (typeof entry[key] !== "string" || entry[key].length === 0) {
      throw new Error(`${label} entries must include ${key}`);
    }
  }

  if ("reason" in entry && typeof entry.reason !== "string") {
    throw new Error(`${label} entry reason must be a string when present`);
  }

  return entry;
}

function loadBoundaryBaseline(filePath = baselinePath) {
  const raw = readJson(filePath);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid package-boundary baseline at ${filePath}`);
  }

  const allowedImportEdges = Array.isArray(raw.allowedImportEdges)
    ? raw.allowedImportEdges.map((entry) =>
        normalizeBaselineEntry(entry, ["fromFile", "toPackage"], "allowedImportEdges"),
      )
    : [];
  const allowedManifestEdges = Array.isArray(raw.allowedManifestEdges)
    ? raw.allowedManifestEdges.map((entry) =>
        normalizeBaselineEntry(entry, ["fromPackage", "toPackage"], "allowedManifestEdges"),
      )
    : [];

  return {
    allowedImportEdges,
    allowedManifestEdges,
  };
}

function normalizeBaseline(baseline = loadBoundaryBaseline()) {
  return {
    importEdges: new Set(
      baseline.allowedImportEdges.map((entry) => `${entry.fromFile}->${entry.toPackage}`),
    ),
    manifestEdges: new Set(
      baseline.allowedManifestEdges.map((entry) => `${entry.fromPackage}->${entry.toPackage}`),
    ),
  };
}

function resolveWorkspacePackageName(specifier, workspaceNames) {
  let match = null;

  for (const candidate of workspaceNames) {
    if (specifier === candidate || specifier.startsWith(`${candidate}/`)) {
      if (match === null || candidate.length > match.length) {
        match = candidate;
      }
    }
  }

  return match;
}

function collectManifestEdges(pkg, workspaceNames) {
  const edges = [];

  for (const dependencyField of DEPENDENCY_FIELDS) {
    const dependencies = pkg.manifest[dependencyField];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;

    for (const dependencyName of Object.keys(dependencies).toSorted()) {
      const toPackage = resolveWorkspacePackageName(dependencyName, workspaceNames);
      if (!toPackage) continue;

      edges.push({
        dependencyField,
        fromPackage: pkg.name,
        manifestPath: pkg.manifestPath,
        toPackage,
      });
    }
  }

  return edges;
}

function walkSourceFiles(dirPath, rootDir, files) {
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(fullPath, rootDir, files);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name))) continue;

    files.push(path.relative(rootDir, fullPath).replaceAll("\\", "/"));
  }
}

function listSourceFiles(pkg, rootDir) {
  const files = [];
  walkSourceFiles(pkg.packageDir, rootDir, files);
  return files.toSorted();
}

function extractModuleSpecifiers(sourceText) {
  const specifiers = new Set();

  for (const pattern of MODULE_SPECIFIER_PATTERNS) {
    for (const match of sourceText.matchAll(pattern)) {
      const specifier = match[1];
      if (typeof specifier === "string" && specifier.length > 0) {
        specifiers.add(specifier);
      }
    }
  }

  return [...specifiers].toSorted();
}

function collectImportEdges(pkg, rootDir, workspaceNames) {
  const edges = [];

  for (const relativePath of listSourceFiles(pkg, rootDir)) {
    const sourceText = readFileSync(path.join(rootDir, relativePath), "utf8");
    for (const specifier of extractModuleSpecifiers(sourceText)) {
      const toPackage = resolveWorkspacePackageName(specifier, workspaceNames);
      if (!toPackage) continue;

      edges.push({
        fromFile: relativePath,
        fromPackage: pkg.name,
        toPackage,
      });
    }
  }

  return edges;
}

function resolveLocalImportPath(rootDir, fromFile, specifier) {
  const absoluteFromFile = path.join(rootDir, fromFile);
  const resolvedBase = path.resolve(path.dirname(absoluteFromFile), specifier);
  const extension = path.extname(resolvedBase);
  const extensionlessBase =
    extension.length > 0 && LOCAL_MODULE_RESOLUTION_EXTENSIONS.includes(extension)
      ? resolvedBase.slice(0, -extension.length)
      : resolvedBase;
  const candidates = [
    resolvedBase,
    ...LOCAL_MODULE_RESOLUTION_EXTENSIONS.map(
      (candidateExtension) => `${extensionlessBase}${candidateExtension}`,
    ),
    ...LOCAL_MODULE_RESOLUTION_EXTENSIONS.map((candidateExtension) =>
      path.join(extensionlessBase, `index${candidateExtension}`),
    ),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const relativePath = path.relative(rootDir, candidate).replaceAll("\\", "/");
    if (relativePath.startsWith("../")) continue;
    return relativePath;
  }

  return null;
}

function collectLocalImportEdges(pkg, rootDir) {
  const edges = [];

  for (const fromFile of listSourceFiles(pkg, rootDir)) {
    const sourceText = readFileSync(path.join(rootDir, fromFile), "utf8");
    for (const specifier of extractModuleSpecifiers(sourceText)) {
      if (!specifier.startsWith(".")) continue;

      const toFile = resolveLocalImportPath(rootDir, fromFile, specifier);
      if (!toFile) continue;

      edges.push({
        fromFile,
        fromPackage: pkg.name,
        toFile,
      });
    }
  }

  return edges;
}

function matchesPathPattern(filePath, pattern) {
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return filePath === prefix || filePath.startsWith(`${prefix}/`);
  }

  return filePath === pattern;
}

function matchesAnyPathPattern(filePath, patterns) {
  return patterns.some((pattern) => matchesPathPattern(filePath, pattern));
}

function collectGatewayInternalViolations({ pkg, rootDir, rules }) {
  const violations = [];
  const boundaryRules = Array.isArray(rules.gatewayInternalBoundaries)
    ? rules.gatewayInternalBoundaries
    : [];
  if (boundaryRules.length === 0) return violations;

  for (const edge of collectLocalImportEdges(pkg, rootDir)) {
    for (const boundaryRule of boundaryRules) {
      if (!matchesAnyPathPattern(edge.fromFile, boundaryRule.sourcePatterns)) continue;
      if (!matchesAnyPathPattern(edge.toFile, boundaryRule.forbiddenTargetPatterns)) continue;

      violations.push({
        fromFile: edge.fromFile,
        fromPackage: pkg.name,
        kind: "forbidden-gateway-entrypoint-import-edge",
        toFile: edge.toFile,
        toPackage: pkg.name,
      });
    }
  }

  return violations;
}

function isTargetPackage(rules, packageName) {
  return Object.hasOwn(rules.targetPackages, packageName);
}

function isForbiddenTargetEdge(rules, fromPackage, toPackage) {
  if (fromPackage === toPackage) return false;
  if (!isTargetPackage(rules, fromPackage)) return false;
  if (!isTargetPackage(rules, toPackage)) return false;

  const allowedTargets = rules.targetPackages[fromPackage] ?? [];
  return !allowedTargets.includes(toPackage);
}

function getLegacyRule(rules, packageName) {
  return rules.legacyPackages[packageName] ?? null;
}

function isLegacyRuleActive(rule, workspaceNames) {
  if (!rule) return false;

  if (rule.activation === "all") {
    return rule.replacementPackages.every((packageName) => workspaceNames.includes(packageName));
  }

  if (rule.activation === "any") {
    return rule.replacementPackages.some((packageName) => workspaceNames.includes(packageName));
  }

  throw new Error(`Unknown legacy activation mode: ${String(rule.activation)}`);
}

function isForbiddenLegacyEdge(rules, workspaceNames, fromPackage, toPackage) {
  if (fromPackage === toPackage) return null;

  const rule = getLegacyRule(rules, toPackage);
  if (!rule) return null;
  if (!isLegacyRuleActive(rule, workspaceNames)) return null;

  return rule.replacementPackages;
}

function compareViolations(a, b) {
  return (
    [
      a.kind.localeCompare(b.kind),
      (a.fromFile ?? a.manifestPath ?? a.fromPackage).localeCompare(
        b.fromFile ?? b.manifestPath ?? b.fromPackage,
      ),
      a.toPackage.localeCompare(b.toPackage),
    ].find((value) => value !== 0) ?? 0
  );
}

export function collectBoundaryViolations({
  baseline,
  repoRoot: rootDir = repoRoot,
  rules = PACKAGE_BOUNDARY_RULES,
}) {
  const normalizedBaseline = normalizeBaseline(baseline);
  const workspacePackages = loadWorkspacePackages(rootDir);
  const workspaceNames = workspacePackages.map((pkg) => pkg.name);
  const violations = [];

  for (const pkg of workspacePackages) {
    for (const edge of collectManifestEdges(pkg, workspaceNames)) {
      const manifestKey = `${edge.fromPackage}->${edge.toPackage}`;
      if (
        isForbiddenTargetEdge(rules, edge.fromPackage, edge.toPackage) &&
        !normalizedBaseline.manifestEdges.has(manifestKey)
      ) {
        violations.push({
          fromPackage: edge.fromPackage,
          kind: "forbidden-target-manifest-edge",
          manifestPath: edge.manifestPath,
          toPackage: edge.toPackage,
        });
      }

      const replacementPackages = isForbiddenLegacyEdge(
        rules,
        workspaceNames,
        edge.fromPackage,
        edge.toPackage,
      );
      if (replacementPackages && !normalizedBaseline.manifestEdges.has(manifestKey)) {
        violations.push({
          fromPackage: edge.fromPackage,
          kind: "legacy-manifest-edge",
          manifestPath: edge.manifestPath,
          replacementPackages,
          toPackage: edge.toPackage,
        });
      }
    }

    for (const edge of collectImportEdges(pkg, rootDir, workspaceNames)) {
      const importKey = `${edge.fromFile}->${edge.toPackage}`;
      if (
        isForbiddenTargetEdge(rules, edge.fromPackage, edge.toPackage) &&
        !normalizedBaseline.importEdges.has(importKey)
      ) {
        violations.push({
          fromFile: edge.fromFile,
          fromPackage: edge.fromPackage,
          kind: "forbidden-target-import-edge",
          toPackage: edge.toPackage,
        });
      }

      const replacementPackages = isForbiddenLegacyEdge(
        rules,
        workspaceNames,
        edge.fromPackage,
        edge.toPackage,
      );
      if (replacementPackages && !normalizedBaseline.importEdges.has(importKey)) {
        violations.push({
          fromFile: edge.fromFile,
          fromPackage: edge.fromPackage,
          kind: "legacy-import-edge",
          replacementPackages,
          toPackage: edge.toPackage,
        });
      }
    }

    violations.push(...collectGatewayInternalViolations({ pkg, rootDir, rules }));
  }

  return violations.toSorted(compareViolations);
}

export function formatViolation(violation) {
  const location = violation.fromFile ?? violation.manifestPath ?? violation.fromPackage;

  if (violation.kind === "forbidden-target-import-edge") {
    return `${location} imports ${violation.toPackage}, but ${violation.fromPackage} cannot point there under the target-state package graph.`;
  }

  if (violation.kind === "forbidden-target-manifest-edge") {
    return `${location} declares ${violation.fromPackage} -> ${violation.toPackage}, but that workspace edge is forbidden by the target-state package graph.`;
  }

  if (violation.kind === "forbidden-gateway-entrypoint-import-edge") {
    return `${location} imports ${violation.toFile ?? "<unknown file>"}, but gateway route and WebSocket entrypoints must depend on packages/gateway/src/app/** seams instead of packages/gateway/src/modules/** directly.`;
  }

  const replacements = violation.replacementPackages?.join(", ") ?? "<unknown replacement>";
  if (violation.kind === "legacy-import-edge") {
    return `${location} imports legacy package ${violation.toPackage} after replacement package(s) ${replacements} exist. Move the code or update the boundary rules deliberately if the live graph changed.`;
  }

  return `${location} declares a legacy edge ${violation.fromPackage} -> ${violation.toPackage} after replacement package(s) ${replacements} exist. Move the dependency or update the boundary rules deliberately if the live graph changed.`;
}

export function parseArgs(argv) {
  const parsed = {
    baselinePath,
    repoRoot,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root requires a path");
      parsed.repoRoot = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--baseline") {
      const value = argv[index + 1];
      if (!value) throw new Error("--baseline requires a path");
      parsed.baselinePath = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

export function runBoundaryCheck(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const violations = collectBoundaryViolations({
    baseline: loadBoundaryBaseline(args.baselinePath),
    repoRoot: args.repoRoot,
  });

  if (violations.length === 0) {
    console.log("package-boundary check passed.");
    return 0;
  }

  console.error("Package boundary violations found:");
  for (const violation of violations) {
    console.error(`- ${formatViolation(violation)}`);
  }
  console.error("");
  console.error(
    "Update docs/architecture/target-state.md, scripts/lint/package-boundaries.config.mjs, and scripts/lint/package-boundaries-baseline.json together when the live graph changes.",
  );
  return 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exit(runBoundaryCheck());
}
