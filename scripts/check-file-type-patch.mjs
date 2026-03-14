import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

function fail(reason, remediation, err) {
  const lines = [
    "Patched dependency check failed: file-type ASF loop guard is inactive.",
    "",
    reason,
    "",
    "Remediation:",
    ...remediation.map((line) => `- ${line}`),
  ];

  if (err instanceof Error && err.message) {
    lines.push("", "Underlying error:", err.message);
  }

  console.error(lines.join("\n"));
  process.exit(1);
}

export function hasLoopGuard(source) {
  return (
    source.includes("const previousPosition = tokenizer.position;") &&
    source.includes("if (tokenizer.position <= previousPosition) {")
  );
}

export function injectLoopGuard(source) {
  const loopStart = "\t\twhile (tokenizer.position + 24 < tokenizer.fileInfo.size) {\n";
  const readHeaderLine = "\t\t\tconst header = await readHeader();";
  const ignorePayloadBlock = "\t\t\tawait tokenizer.ignore(payload);\n\t\t}";

  if (
    !source.includes(loopStart) ||
    !source.includes(readHeaderLine) ||
    !source.includes(ignorePayloadBlock)
  ) {
    return source;
  }

  let patched = source.replace(
    `${loopStart}${readHeaderLine}`,
    `${loopStart}\t\t\tconst previousPosition = tokenizer.position;\n${readHeaderLine}`,
  );

  patched = patched.replace(
    ignorePayloadBlock,
    [
      "\t\t\tawait tokenizer.ignore(payload);",
      "",
      "\t\t\t// Guard against malformed ASF sub-headers that do not advance the tokenizer.",
      "\t\t\tif (tokenizer.position <= previousPosition) {",
      "\t\t\t\tbreak;",
      "\t\t\t}",
      "\t\t}",
    ].join("\n"),
  );

  return patched;
}

export function applyLoopGuardPatch(source) {
  if (hasLoopGuard(source)) {
    return source;
  }

  const patched = injectLoopGuard(source);
  return hasLoopGuard(patched) ? patched : source;
}

function main() {
  try {
    const desktopNodePackageJson = require.resolve("../packages/desktop-node/package.json");
    const nutJsPackageJson = require.resolve("@nut-tree-fork/nut-js/package.json", {
      paths: [dirname(desktopNodePackageJson)],
    });
    const jimpPackageJson = require.resolve("jimp/package.json", {
      paths: [dirname(nutJsPackageJson)],
    });
    const jimpCorePackageJson = require.resolve("@jimp/core/package.json", {
      paths: [dirname(jimpPackageJson)],
    });
    const fileTypeCorePath = require.resolve("file-type/core", {
      paths: [dirname(jimpCorePackageJson)],
    });
    const source = readFileSync(fileTypeCorePath, "utf8");
    const patched = applyLoopGuardPatch(source);

    if (patched !== source) {
      writeFileSync(fileTypeCorePath, patched, "utf8");
    }

    if (!hasLoopGuard(patched)) {
      fail(
        `Expected patched file-type source at ${fileTypeCorePath}.`,
        [
          "Refresh patched dependencies: pnpm install --force",
          "If the problem persists, clear node_modules and reinstall: rm -rf node_modules && pnpm install",
        ],
        undefined,
      );
    }
  } catch (err) {
    fail(
      "Unable to resolve the transitive file-type package used by @tyrum/desktop-node.",
      [
        "Install dependencies: pnpm install",
        "If dependencies were already installed, refresh the virtual store: pnpm install --force",
      ],
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
