import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);

function fail(err) {
  const message = err instanceof Error ? err.message : String(err);
  const lines = [
    "Desktop sandbox native preflight failed.",
    "",
    `platform=${process.platform}`,
    `arch=${process.arch}`,
    "",
    "The desktop sandbox depends on @nut-tree-fork/nut-js loading successfully inside the image.",
    "The published libnut Linux addon currently fails on linux/arm64 because it bundles an x86_64 libnut.node.",
    "Keep the published desktop-sandbox image amd64-only until the upstream native addon ships a real arm64 build.",
    "",
    "Underlying error:",
    message,
  ];
  console.error(lines.join("\n"));
  process.exit(1);
}

try {
  const desktopNodePackageJson = require.resolve("../packages/desktop-node/package.json");
  const desktopNodeDir = dirname(desktopNodePackageJson);
  const nutJsEntry = require.resolve("@nut-tree-fork/nut-js", {
    paths: [desktopNodeDir],
  });

  require(nutJsEntry);
} catch (err) {
  fail(err);
}
