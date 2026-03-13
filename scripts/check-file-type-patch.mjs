import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

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

  const hasLoopGuard =
    source.includes("const previousPosition = tokenizer.position;") &&
    source.includes("if (tokenizer.position <= previousPosition) {");

  if (!hasLoopGuard) {
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
