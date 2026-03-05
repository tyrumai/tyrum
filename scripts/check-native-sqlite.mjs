import { createRequire } from "node:module";

const EXPECTED_NODE_MAJOR = 24;
const nodeVersion = process.versions.node;
const nodeMajor = Number(nodeVersion.split(".")[0] ?? "");
const target = process.env.TYRUM_NATIVE_SQLITE_CHECK_TARGET || "better-sqlite3";

function errorDetails(err) {
  if (!err) return {};
  if (typeof err !== "object") return { message: String(err) };
  const anyErr = /** @type {any} */ (err);
  return {
    code: typeof anyErr.code === "string" ? anyErr.code : undefined,
    message: typeof anyErr.message === "string" ? anyErr.message : String(err),
  };
}

function fail(header, reason, remediation, err) {
  const { code, message } = errorDetails(err);

  const lines = [
    header,
    "",
    reason,
    "",
    "Environment:",
    `- node: v${nodeVersion} (expected v${String(EXPECTED_NODE_MAJOR)}.x)`,
    `- platform: ${process.platform} ${process.arch}`,
    "",
    "Remediation:",
    ...remediation.map((line) => `- ${line}`),
  ];

  if (message) {
    lines.push("", "Underlying error:", code ? `${code}: ${message}` : message);
  }

  console.error(lines.join("\n"));
  process.exit(1);
}

if (!Number.isFinite(nodeMajor) || nodeMajor !== EXPECTED_NODE_MAJOR) {
  fail(
    "Native SQLite preflight failed: unsupported Node.js version.",
    `This repo requires Node ${String(EXPECTED_NODE_MAJOR)}.x (got v${nodeVersion}).`,
    [
      `Use Node ${String(EXPECTED_NODE_MAJOR)} (see .nvmrc/.node-version)`,
      "Then reinstall dependencies: rm -rf node_modules && pnpm install",
    ],
    undefined,
  );
}

try {
  const gatewayRequire = createRequire(
    new URL("../packages/gateway/package.json", import.meta.url),
  );
  const Database = gatewayRequire(target);
  if (typeof Database !== "function") {
    fail(
      "Native SQLite preflight failed: unexpected better-sqlite3 export.",
      `Imported ${target}, but it did not export a Database constructor.`,
      ["Reinstall dependencies: rm -rf node_modules && pnpm install"],
      undefined,
    );
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
  const { code } = errorDetails(err);
  const isDlOpenFailed = code === "ERR_DLOPEN_FAILED";
  const isNotFound = code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND";

  const reason = isDlOpenFailed
    ? "This is usually a Node ABI mismatch (ERR_DLOPEN_FAILED) after switching Node versions without rebuilding native modules."
    : isNotFound
      ? "Could not resolve better-sqlite3 from @tyrum/gateway dependencies."
      : "Failed to load and instantiate better-sqlite3.";

  const remediation = [
    `Ensure you're using Node ${String(EXPECTED_NODE_MAJOR)} (check: node -v; see .nvmrc/.node-version)`,
    ...(isNotFound ? ["Install dependencies: pnpm install"] : []),
    "Rebuild native bindings: pnpm rebuild better-sqlite3",
    "If still broken: rm -rf node_modules && pnpm install",
  ];

  fail("Native SQLite preflight failed: unable to load better-sqlite3.", reason, remediation, err);
}
