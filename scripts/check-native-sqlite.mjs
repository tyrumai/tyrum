import { createRequire } from "node:module";

const EXPECTED_NODE_MAJOR = 24;
const nodeVersion = process.versions.node;
const nodeMajor = Number(nodeVersion.split(".")[0] ?? "");
const target = process.env.TYRUM_NATIVE_SQLITE_CHECK_TARGET || "better-sqlite3";

function errorDetails(err) {
  if (!err || typeof err !== "object") return { message: String(err) };
  const anyErr = /** @type {any} */ (err);
  return {
    code: typeof anyErr.code === "string" ? anyErr.code : undefined,
    message: typeof anyErr.message === "string" ? anyErr.message : String(err),
  };
}

function fail(reason, err) {
  const { code, message } = errorDetails(err);

  const lines = [
    "Native SQLite preflight failed: unable to load better-sqlite3.",
    "",
    reason,
    "",
    "Environment:",
    `- node: v${nodeVersion} (expected v${String(EXPECTED_NODE_MAJOR)}.x)`,
    `- platform: ${process.platform} ${process.arch}`,
    "",
    "Remediation:",
    `- Ensure you're using Node ${String(EXPECTED_NODE_MAJOR)} (check: node -v; see .nvmrc/.node-version)`,
    "- Rebuild native bindings: pnpm rebuild better-sqlite3",
    "- If still broken: rm -rf node_modules && pnpm install",
    "",
    "Underlying error:",
    code ? `${code}: ${message}` : message,
  ];

  console.error(lines.join("\n"));
  process.exit(1);
}

if (!Number.isFinite(nodeMajor) || nodeMajor !== EXPECTED_NODE_MAJOR) {
  fail(`This repo requires Node ${String(EXPECTED_NODE_MAJOR)}.`, undefined);
}

try {
  const gatewayRequire = createRequire(
    new URL("../packages/gateway/package.json", import.meta.url),
  );
  const Database = gatewayRequire(target);
  if (typeof Database !== "function") {
    fail(`Imported ${target}, but it did not export a Database constructor.`, undefined);
  }

  const db = new Database(":memory:");
  try {
    if (typeof db.prepare === "function") {
      db.prepare("select 1").get();
    } else if (typeof db.exec === "function") {
      db.exec("select 1");
    }
  } finally {
    if (db && typeof db.close === "function") db.close();
  }
} catch (err) {
  fail(
    "This is usually a Node ABI mismatch (ERR_DLOPEN_FAILED) after switching Node versions without rebuilding native modules.",
    err,
  );
}
