#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";

function normalizePath(p) {
  return p.replaceAll("\\", "/");
}

function pct(covered, total) {
  if (!total) return null;
  return (covered / total) * 100;
}

function formatPct(value) {
  if (value === null) return "n/a";
  return `${value.toFixed(2)}%`;
}

function parseArgs(argv) {
  const args = { coveragePath: "coverage/coverage-final.json", json: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--coverage" && argv[i + 1]) {
      args.coveragePath = argv[++i];
      continue;
    }
    if (token === "--json") {
      args.json = true;
      continue;
    }
  }
  return args;
}

function groupKeyForFile(filePath) {
  const norm = normalizePath(filePath);
  const match = norm.match(/(?:^|\/)(packages|apps)\/([^/]+)\//);
  if (!match) return "other";
  return `${match[1]}/${match[2]}`;
}

function fileStats(entry) {
  const s = entry.s ?? {};
  const f = entry.f ?? {};
  const b = entry.b ?? {};
  const statementMap = entry.statementMap ?? {};

  let linesTotal = 0;
  let linesCovered = 0;
  {
    const lineCounts = new Map();
    for (const [id, loc] of Object.entries(statementMap)) {
      const line = loc?.start?.line;
      if (typeof line !== "number") continue;
      const count = s[id] ?? 0;
      const prev = lineCounts.get(line);
      if (prev === undefined || count > prev) lineCounts.set(line, count);
    }
    linesTotal = lineCounts.size;
    for (const count of lineCounts.values()) if (count > 0) linesCovered++;
  }

  let statementsTotal = 0;
  let statementsCovered = 0;
  for (const id of Object.keys(s)) {
    statementsTotal++;
    if ((s[id] ?? 0) > 0) statementsCovered++;
  }

  let functionsTotal = 0;
  let functionsCovered = 0;
  for (const id of Object.keys(f)) {
    functionsTotal++;
    if ((f[id] ?? 0) > 0) functionsCovered++;
  }

  let branchesTotal = 0;
  let branchesCovered = 0;
  for (const id of Object.keys(b)) {
    const paths = b[id];
    if (!Array.isArray(paths)) continue;
    for (const count of paths) {
      branchesTotal++;
      if ((count ?? 0) > 0) branchesCovered++;
    }
  }

  return {
    files: 1,
    linesTotal,
    linesCovered,
    statementsTotal,
    statementsCovered,
    functionsTotal,
    functionsCovered,
    branchesTotal,
    branchesCovered,
  };
}

function addInto(target, delta) {
  for (const [key, value] of Object.entries(delta)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

const COMPONENT_META = {
  "packages/contracts": { type: "contracts/validation" },
  "packages/gateway": { type: "gateway runtime (HTTP/WS + persistence)" },
  "packages/client": { type: "SDK/protocol client" },
  "packages/operator-app": { type: "UI state/store logic" },
  "packages/operator-ui": { type: "React UI library" },
  "packages/tui": { type: "terminal UI" },
  "packages/cli": { type: "CLI wiring" },
  "apps/desktop": { type: "Electron desktop app" },
  "apps/web": { type: "web app (Vite/React)" },
};

function componentType(componentKey) {
  return COMPONENT_META[componentKey]?.type ?? "";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const coveragePath = path.resolve(repoRoot, args.coveragePath);

  const raw = readFileSync(coveragePath, "utf8");
  const coverage = JSON.parse(raw);

  const groups = new Map();
  const global = {};

  for (const [filePath, entry] of Object.entries(coverage)) {
    const stats = fileStats(entry);
    addInto(global, stats);

    const groupKey = groupKeyForFile(filePath);
    const acc = groups.get(groupKey) ?? {};
    addInto(acc, stats);
    groups.set(groupKey, acc);
  }

  const rows = [...groups.entries()]
    .map(([key, s]) => {
      const lines = pct(s.linesCovered, s.linesTotal);
      const stmts = pct(s.statementsCovered, s.statementsTotal);
      const fns = pct(s.functionsCovered, s.functionsTotal);
      const branches = pct(s.branchesCovered, s.branchesTotal);
      return {
        component: key,
        type: componentType(key),
        files: s.files ?? 0,
        lines,
        stmts,
        fns,
        branches,
        counts: s,
      };
    })
    .filter((r) => r.component !== "other")
    .sort((a, b) => a.component.localeCompare(b.component));

  const globalRow = {
    component: "GLOBAL",
    type: "",
    files: global.files ?? 0,
    lines: pct(global.linesCovered, global.linesTotal),
    stmts: pct(global.statementsCovered, global.statementsTotal),
    fns: pct(global.functionsCovered, global.functionsTotal),
    branches: pct(global.branchesCovered, global.branchesTotal),
    counts: global,
  };

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          coveragePath: path.relative(repoRoot, coveragePath),
          global: globalRow,
          components: rows,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  process.stdout.write("### Coverage by component\n\n");
  process.stdout.write(
    "_Scope: `packages/*/src/**/*.{ts,tsx,js,jsx}` and `apps/*/src/**/*.{ts,tsx,js,jsx}`._\n\n",
  );

  process.stdout.write(
    "| Component | Type | Files | Lines | Statements | Functions | Branches |\n",
  );
  process.stdout.write("|---|---|---:|---:|---:|---:|---:|\n");

  for (const r of rows) {
    process.stdout.write(
      `| ${r.component} | ${r.type} | ${r.files} | ${formatPct(r.lines)} | ${formatPct(r.stmts)} | ${formatPct(r.fns)} | ${formatPct(r.branches)} |\n`,
    );
  }

  process.stdout.write(
    `| ${globalRow.component} |  | ${globalRow.files} | ${formatPct(globalRow.lines)} | ${formatPct(globalRow.stmts)} | ${formatPct(globalRow.fns)} | ${formatPct(globalRow.branches)} |\n`,
  );
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`coverage/components: ${message}\n`);
  process.exitCode = 1;
}
