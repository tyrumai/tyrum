import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const CODEX_THREAD_MAP_NAME = "codex-thread-map";

const BLOCK_PATTERN = /<!--\s*codex-thread-map\n(?<body>[\s\S]*?)\n?-->/m;
const ORDERED_KEYS = [
  "version",
  "issue",
  "role",
  "parent_issue",
  "root_issue",
  "codex_thread_id",
  "codex_thread_url",
  "spawned_from_thread_id",
  "last_sync",
];

function sanitizeValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).replaceAll(/\r?\n/g, " ").trim();
}

function parseFields(body) {
  const fields = {};
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\s*([a-z0-9_]+):\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, value] = match;
    fields[key] = value;
  }
  return fields;
}

export function parseCodexThreadMap(markdown) {
  const match = markdown.match(BLOCK_PATTERN);
  if (!match?.groups?.body) return null;
  return parseFields(match.groups.body);
}

export function formatCodexThreadMap(fields) {
  const normalized = {
    version: "1",
    issue: "pending",
    role: "parent",
    parent_issue: "",
    root_issue: "",
    codex_thread_id: "",
    codex_thread_url: "",
    spawned_from_thread_id: "",
    last_sync: "",
    ...fields,
  };
  const lines = ORDERED_KEYS.map((key) => `${key}: ${sanitizeValue(normalized[key])}`);
  return `<!-- ${CODEX_THREAD_MAP_NAME}\n${lines.join("\n")}\n-->`;
}

function insertionIndex(markdown) {
  const frontMatterMatch = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return frontMatterMatch ? frontMatterMatch[0].length : 0;
}

export function upsertCodexThreadMap(markdown, fields) {
  const existing = parseCodexThreadMap(markdown) ?? {};
  const nextBlock = formatCodexThreadMap({ ...existing, ...fields });
  if (BLOCK_PATTERN.test(markdown)) {
    return markdown.replace(BLOCK_PATTERN, nextBlock);
  }

  const index = insertionIndex(markdown);
  const prefix = markdown.slice(0, index);
  const suffix = markdown.slice(index).replace(/^\s*/, "");
  return `${prefix}${nextBlock}\n\n${suffix}`;
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

function readBooleanOption(args, name) {
  return args.includes(name);
}

function cliFields(args) {
  return {
    issue: readOption(args, "--issue"),
    role: readOption(args, "--role"),
    parent_issue: readOption(args, "--parent-issue"),
    root_issue: readOption(args, "--root-issue"),
    codex_thread_id: readOption(args, "--thread-id"),
    codex_thread_url: readOption(args, "--thread-url"),
    spawned_from_thread_id: readOption(args, "--spawned-from-thread-id"),
    last_sync: readOption(args, "--last-sync"),
  };
}

function compactFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined && value !== ""),
  );
}

async function main() {
  const [, , command, file, ...args] = process.argv;
  if (!command || !file || !["extract", "upsert"].includes(command)) {
    console.error(
      [
        "Usage:",
        "  node scripts/codex-thread-map.mjs extract <issue-body.md>",
        "  node scripts/codex-thread-map.mjs upsert <issue-body.md> [options] [--write]",
        "",
        "Options:",
        "  --issue <number>",
        "  --role <hub|daily-sweep|parent|child>",
        "  --parent-issue <number>",
        "  --root-issue <number>",
        "  --thread-id <id>",
        "  --thread-url <url>",
        "  --spawned-from-thread-id <id>",
        "  --last-sync <iso-datetime>",
      ].join("\n"),
    );
    process.exit(1);
  }

  const markdown = await readFile(file, "utf8");
  if (command === "extract") {
    process.stdout.write(`${JSON.stringify(parseCodexThreadMap(markdown) ?? {}, null, 2)}\n`);
    return;
  }

  const updated = upsertCodexThreadMap(markdown, compactFields(cliFields(args)));
  if (readBooleanOption(args, "--write")) {
    await writeFile(file, updated);
    return;
  }
  process.stdout.write(updated);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
