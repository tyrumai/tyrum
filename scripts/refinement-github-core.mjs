import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { upsertCodexThreadMap } from "./codex-thread-map.mjs";
import {
  DEFAULT_GH,
  fillHubTemplate,
  fillSweepTemplate,
  HUB_TEMPLATE,
  LABELS,
  nextVantageFromSweeps,
  PROJECT_FIELDS,
  recordSweepInHubBody,
  REFINEMENT_OWNER,
  REFINEMENT_PROJECT_TITLE,
  REFINEMENT_REPO,
  SWEEP_TEMPLATE,
  VANTAGE_ROTATION,
} from "./refinement-github-data.mjs";

const execFileAsync = promisify(execFile);

const nowIso = () => new Date().toISOString();
const todayIsoDate = () => new Date().toISOString().slice(0, 10);

function parseJson(output, fallback) {
  const trimmed = output.trim();
  if (!trimmed) return fallback;
  return JSON.parse(trimmed);
}

function titleMatches(title, expected) {
  return String(title).trim().toLowerCase() === expected.toLowerCase();
}

function projectNumber(project) {
  return project?.number ?? project?.Number ?? project?.id ?? project?.Id;
}

function issueNumber(issue) {
  return Number(issue?.number);
}

function uniqueLabels(...labels) {
  return [...new Set(labels.flatMap((label) => label.split(",")).map((label) => label.trim()))]
    .filter(Boolean)
    .join(",");
}

function formatCommand(command) {
  return [command.bin, ...command.args].join(" ");
}

async function runCommand(command) {
  const { stdout, stderr } = await execFileAsync(command.bin, command.args, {
    cwd: command.cwd,
    maxBuffer: 1024 * 1024 * 20,
  });
  return { stdout, stderr };
}

export function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift() ?? "help";
  const options = { command, apply: false, gh: DEFAULT_GH, repo: REFINEMENT_REPO };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.apply = false;
      continue;
    }
    if (arg === "--gh") {
      options.gh = args[++index];
      continue;
    }
    if (arg === "--repo") {
      options.repo = args[++index];
      continue;
    }
    if (arg === "--issue") {
      options.issue = args[++index];
      continue;
    }
    if (arg === "--thread-id") {
      options.threadId = args[++index];
      continue;
    }
    if (arg === "--thread-url") {
      options.threadUrl = args[++index];
      continue;
    }
    if (arg === "--spawned-from-thread-id") {
      options.spawnedFromThreadId = args[++index];
      continue;
    }
    if (arg === "--parent-issue") {
      options.parentIssue = args[++index];
      continue;
    }
    if (arg === "--root-issue") {
      options.rootIssue = args[++index];
      continue;
    }
    if (arg === "--vantage") {
      options.vantage = args[++index];
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

export function buildDryRunPlan(command, operations) {
  return {
    command,
    mode: "dry-run",
    operations: operations.map((operation) => ({
      title: operation.title,
      command: operation.command ? formatCommand(operation.command) : undefined,
    })),
  };
}

export async function doctor(options, runner = runCommand) {
  const commands = [
    { title: "Check GitHub CLI version", bin: options.gh, args: ["--version"] },
    { title: "Check GitHub auth", bin: options.gh, args: ["auth", "status"] },
    {
      title: "Check repository access",
      bin: options.gh,
      args: ["repo", "view", options.repo, "--json", "nameWithOwner,defaultBranchRef"],
    },
    {
      title: "Check GitHub Project support",
      bin: options.gh,
      args: ["project", "list", "--owner", REFINEMENT_OWNER, "--limit", "20", "--format", "json"],
    },
    {
      title: "Check refinement labels",
      bin: options.gh,
      args: ["label", "list", "-R", options.repo, "--limit", "200", "--json", "name"],
    },
    {
      title: "Check refinement issues",
      bin: options.gh,
      args: [
        "issue",
        "list",
        "-R",
        options.repo,
        "--label",
        "product-refinement",
        "--limit",
        "100",
        "--json",
        "number,title,url,labels",
      ],
    },
  ].map((command) => Object.assign(command, { cwd: process.cwd() }));

  if (!options.apply)
    return buildDryRunPlan(
      "doctor",
      commands.map((command) => ({ title: command.title, command })),
    );

  const results = [];
  for (const command of commands) {
    const result = await runner(command);
    results.push({
      title: command.title,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    });
  }
  return { command: "doctor", mode: "apply", results };
}

async function listLabels(options, runner) {
  const result = await runner({
    bin: options.gh,
    cwd: process.cwd(),
    args: ["label", "list", "-R", options.repo, "--limit", "200", "--json", "name"],
  });
  return parseJson(result.stdout, []).map((label) => label.name);
}

async function ensureLabels(options, runner, operations) {
  const existing = options.apply ? new Set(await listLabels(options, runner)) : new Set();
  for (const label of LABELS) {
    const command = {
      bin: options.gh,
      cwd: process.cwd(),
      args: [
        "label",
        "create",
        label.name,
        "-R",
        options.repo,
        "--color",
        label.color,
        "--description",
        label.description,
      ],
    };
    if (existing.has(label.name)) {
      operations.push({ title: `Label exists: ${label.name}` });
      continue;
    }
    operations.push({ title: `Create label: ${label.name}`, command });
    if (options.apply) await runner(command);
  }
}

async function listProjects(options, runner) {
  const result = await runner({
    bin: options.gh,
    cwd: process.cwd(),
    args: ["project", "list", "--owner", REFINEMENT_OWNER, "--limit", "100", "--format", "json"],
  });
  const parsed = parseJson(result.stdout, {});
  return parsed.projects ?? parsed.items ?? parsed;
}

async function ensureProject(options, runner, operations) {
  if (!options.apply) {
    const command = {
      bin: options.gh,
      cwd: process.cwd(),
      args: ["project", "create", "--owner", REFINEMENT_OWNER, "--title", REFINEMENT_PROJECT_TITLE],
    };
    operations.push({ title: `Create project if missing: ${REFINEMENT_PROJECT_TITLE}`, command });
    return { number: "<project-number>" };
  }

  const projects = await listProjects(options, runner);
  const existing = projects.find((project) =>
    titleMatches(project.title, REFINEMENT_PROJECT_TITLE),
  );
  if (existing) {
    operations.push({ title: `Project exists: ${REFINEMENT_PROJECT_TITLE}` });
    return existing;
  }

  const command = {
    bin: options.gh,
    cwd: process.cwd(),
    args: [
      "project",
      "create",
      "--owner",
      REFINEMENT_OWNER,
      "--title",
      REFINEMENT_PROJECT_TITLE,
      "--format",
      "json",
    ],
  };
  operations.push({ title: `Create project: ${REFINEMENT_PROJECT_TITLE}`, command });
  const result = await runner(command);
  return parseJson(result.stdout, {});
}

async function listProjectFields(options, runner, project) {
  const result = await runner({
    bin: options.gh,
    cwd: process.cwd(),
    args: [
      "project",
      "field-list",
      String(projectNumber(project)),
      "--owner",
      REFINEMENT_OWNER,
      "--limit",
      "100",
      "--format",
      "json",
    ],
  });
  const parsed = parseJson(result.stdout, {});
  return parsed.fields ?? parsed.items ?? parsed;
}

function fieldCreateArgs(project, field) {
  const args = [
    "project",
    "field-create",
    String(projectNumber(project)),
    "--owner",
    REFINEMENT_OWNER,
    "--name",
    field.name,
    "--data-type",
    field.dataType,
  ];
  if (field.options) args.push("--single-select-options", field.options.join(","));
  return args;
}

async function ensureProjectFields(options, runner, operations, project) {
  const existing = options.apply
    ? new Set((await listProjectFields(options, runner, project)).map((field) => field.name))
    : new Set();
  for (const field of PROJECT_FIELDS) {
    const command = {
      bin: options.gh,
      cwd: process.cwd(),
      args: fieldCreateArgs(project, field),
    };
    if (existing.has(field.name)) {
      operations.push({ title: `Project field exists: ${field.name}` });
      continue;
    }
    operations.push({ title: `Create project field: ${field.name}`, command });
    if (options.apply) await runner(command);
  }
}

async function listRefinementIssues(options, runner, labels, state = "open") {
  const args = [
    "issue",
    "list",
    "-R",
    options.repo,
    "--state",
    state,
    "--limit",
    "100",
    "--json",
    "number,title,url,body,labels",
  ];
  for (const label of labels) args.push("--label", label);
  const result = await runner({ bin: options.gh, cwd: process.cwd(), args });
  return parseJson(result.stdout, []);
}

async function createIssue(options, runner, title, body, labels) {
  const result = await runner({
    bin: options.gh,
    cwd: process.cwd(),
    args: [
      "issue",
      "create",
      "-R",
      options.repo,
      "--title",
      title,
      "--body",
      body,
      "--label",
      uniqueLabels(...labels),
    ],
  });
  const url = result.stdout.trim().split(/\r?\n/).at(-1);
  const number = Number(url?.match(/\/issues\/(\d+)$/)?.[1]);
  return { number, url, title, body };
}

async function updateIssueBody(options, runner, issue, body) {
  const tempFile = `/tmp/tyrum-refinement-issue-${issue}.md`;
  await writeFile(tempFile, body);
  await runner({
    bin: options.gh,
    cwd: process.cwd(),
    args: ["issue", "edit", String(issue), "-R", options.repo, "--body-file", tempFile],
  });
}

async function addIssueToProject(options, runner, operations, project, issue) {
  if (!issue?.url) return;
  const command = {
    bin: options.gh,
    cwd: process.cwd(),
    args: [
      "project",
      "item-add",
      String(projectNumber(project)),
      "--owner",
      REFINEMENT_OWNER,
      "--url",
      issue.url,
    ],
  };
  operations.push({ title: `Add issue #${issue.number} to project`, command });
  if (options.apply) await runner(command);
}

async function recordSweepInHub(options, runner, operations, hub, sweepIssue) {
  const updated = recordSweepInHubBody(hub.body ?? "", sweepIssue);
  if (updated === (hub.body ?? "")) return;
  operations.push({ title: `Record sweep #${sweepIssue.number} in hub #${hub.number}` });
  if (options.apply) await updateIssueBody(options, runner, hub.number, updated);
}

async function ensureHubIssue(options, runner, operations, project) {
  if (!options.apply) {
    operations.push({ title: "Create hub issue if missing" });
    operations.push({ title: "Add hub issue to project" });
    return { number: "<hub-issue>", url: "<hub-url>" };
  }

  const existing = await listRefinementIssues(options, runner, ["refinement-hub"]);
  const hub = existing.find((issue) => issue.title.startsWith("[Refinement Hub]"));
  if (hub) {
    operations.push({ title: `Hub issue exists: #${hub.number}` });
    await addIssueToProject(options, runner, operations, project, hub);
    return hub;
  }

  const template = await readFile(HUB_TEMPLATE, "utf8");
  const body = fillHubTemplate(template);
  const issue = await createIssue(
    options,
    runner,
    "[Refinement Hub] Tyrum Product Refinement",
    body,
    ["product-refinement", "refinement-hub"],
  );
  operations.push({ title: `Create hub issue: #${issue.number}` });
  await addIssueToProject(options, runner, operations, project, issue);
  return issue;
}

export async function setup(options, runner = runCommand) {
  const operations = [];
  await ensureLabels(options, runner, operations);
  const project = await ensureProject(options, runner, operations);
  await ensureProjectFields(options, runner, operations, project);
  await ensureHubIssue(options, runner, operations, project);
  if (!options.apply) return buildDryRunPlan("setup", operations);
  return {
    command: "setup",
    mode: "apply",
    operations: operations.map((operation) => operation.title),
  };
}

async function latestHubIssue(options, runner) {
  const hubs = await listRefinementIssues(options, runner, ["refinement-hub"]);
  return hubs.find((issue) => issue.title.startsWith("[Refinement Hub]"));
}

async function existingSweepForDate(options, runner, date) {
  const sweeps = await listRefinementIssues(options, runner, ["daily-sweep"], "all");
  return sweeps.find((issue) => issue.title.startsWith(`[Daily Sweep] ${date}`));
}

async function selectSweepVantage(options, runner) {
  if (options.vantage) return options.vantage;
  if (!options.apply) return VANTAGE_ROTATION[0];
  const sweeps = await listRefinementIssues(options, runner, ["daily-sweep"]);
  return nextVantageFromSweeps(sweeps);
}

export async function createSweep(options, runner = runCommand) {
  const operations = [];
  const date = todayIsoDate();
  const vantage = await selectSweepVantage(options, runner);
  const title = `[Daily Sweep] ${date} - ${vantage}`;

  if (!options.apply) {
    operations.push({ title: `Create or reuse daily sweep: ${title}` });
    operations.push({ title: `Add daily sweep to project: ${REFINEMENT_PROJECT_TITLE}` });
    return buildDryRunPlan("create-sweep", operations);
  }

  const hub = await latestHubIssue(options, runner);
  if (!hub) throw new Error("No refinement hub issue found. Run setup --apply first.");

  const existing = await existingSweepForDate(options, runner, date);
  if (existing) {
    operations.push({ title: `Daily sweep exists: #${existing.number}` });
    await recordSweepInHub(options, runner, operations, hub, existing);
    return { command: "create-sweep", mode: "apply", issue: existing, operations };
  }

  const template = await readFile(SWEEP_TEMPLATE, "utf8");
  const body = upsertCodexThreadMap(
    fillSweepTemplate(template, { date, vantage, hubIssueNumber: issueNumber(hub) }),
    {
      parent_issue: String(issueNumber(hub)),
      root_issue: String(issueNumber(hub)),
    },
  );
  const issue = await createIssue(options, runner, title, body, [
    "product-refinement",
    "daily-sweep",
  ]);
  operations.push({ title: `Create daily sweep issue: #${issue.number}` });
  await recordSweepInHub(options, runner, operations, hub, issue);

  const projects = await listProjects(options, runner);
  const project = projects.find((candidate) =>
    titleMatches(candidate.title, REFINEMENT_PROJECT_TITLE),
  );
  if (project) await addIssueToProject(options, runner, operations, project, issue);
  return { command: "create-sweep", mode: "apply", issue, operations };
}

async function issueView(options, runner, issue) {
  const result = await runner({
    bin: options.gh,
    cwd: process.cwd(),
    args: ["issue", "view", String(issue), "-R", options.repo, "--json", "number,title,body,url"],
  });
  return parseJson(result.stdout, {});
}

export async function syncThreadMap(options, runner = runCommand) {
  if (!options.issue) throw new Error("sync-thread-map requires --issue <number>");
  if (!options.threadId && !options.threadUrl) {
    throw new Error("sync-thread-map requires --thread-id and/or --thread-url");
  }

  if (!options.apply) {
    const operations = [
      { title: `Fetch issue #${options.issue}` },
      { title: `Update codex-thread-map for issue #${options.issue}` },
    ];
    return buildDryRunPlan("sync-thread-map", operations);
  }

  const issue = await issueView(options, runner, options.issue);
  const updated = upsertCodexThreadMap(issue.body ?? "", {
    issue: String(issue.number ?? options.issue),
    parent_issue: options.parentIssue,
    root_issue: options.rootIssue,
    codex_thread_id: options.threadId,
    codex_thread_url: options.threadUrl,
    spawned_from_thread_id: options.spawnedFromThreadId,
    last_sync: nowIso(),
  });
  const tempFile = `/tmp/tyrum-refinement-issue-${options.issue}.md`;
  await writeFile(tempFile, updated);
  await runner({
    bin: options.gh,
    cwd: process.cwd(),
    args: ["issue", "edit", String(options.issue), "-R", options.repo, "--body-file", tempFile],
  });
  return { command: "sync-thread-map", mode: "apply", issue: options.issue };
}
