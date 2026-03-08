import { spawnSync } from "node:child_process";

const DEFAULT_HISTORY_LIMIT = 30;
const DEFAULT_PR_LIMIT = 100;
const MAX_FORCE_PUSH_EVENTS = 100;
const MAX_SAMPLE_LINES = 5;
const MIN_SIGNAL_CHARS = 6;
const GH_MAX_ATTEMPTS = 3;
const GH_RETRY_BASE_DELAY_MS = 1000;
const LOW_SIGNAL_LINE_PATTERNS = [
  /^$/,
  /^[()[\]{};,.\s]+$/,
  /^act\(\(\)\s*=>\s*{$/,
  /^await act\(async \(\)\s*=>\s*{$/,
  /^await Promise\.resolve\(\);$/,
  /^return;$/,
  /^continue;$/,
  /^break;$/,
  /^if \(.+\) {$/,
  /^}$/,
  /^{$/,
  /^}\);$/,
  /^\)\);$/,
  /^\);$/,
];

const SLEEP_BUFFER = new SharedArrayBuffer(4);
const SLEEP_VIEW = new Int32Array(SLEEP_BUFFER);

function fail(message) {
  console.error(message);
  process.exit(1);
}

export function parseArgs(argv) {
  let limit = null;
  let prNumber = null;
  let baseBranch = "main";
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--limit") {
      const value = argv[index + 1];
      if (!value) fail("Missing value for --limit");
      const parsedLimit = Number.parseInt(value, 10);
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        fail(`Invalid --limit value: ${value}`);
      }
      limit = parsedLimit;
      index += 1;
      continue;
    }

    if (arg === "--base") {
      const value = argv[index + 1];
      if (!value) fail("Missing value for --base");
      baseBranch = value;
      index += 1;
      continue;
    }

    if (arg === "--pr") {
      const value = argv[index + 1];
      if (!value) fail("Missing value for --pr");
      const parsedPrNumber = Number.parseInt(value, 10);
      if (!Number.isFinite(parsedPrNumber) || parsedPrNumber <= 0) {
        fail(`Invalid --pr value: ${value}`);
      }
      prNumber = parsedPrNumber;
      index += 1;
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    mode: prNumber === null ? "history" : "current-pr",
    limit: limit ?? (prNumber === null ? DEFAULT_HISTORY_LIMIT : DEFAULT_PR_LIMIT),
    baseBranch,
    json,
    prNumber,
  };
}

function sleepMilliseconds(durationMs) {
  Atomics.wait(SLEEP_VIEW, 0, 0, durationMs);
}

export function runResult(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

function isRetryableGhFailure(result) {
  if (result.status === 0) return false;
  const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.toLowerCase();
  return [
    "502",
    "503",
    "504",
    "bad gateway",
    "gateway timeout",
    "temporarily unavailable",
    "timed out",
    "timeout",
    "connection reset",
    "unexpected eof",
    "http/2 stream",
    "internal server error",
  ].some((pattern) => detail.includes(pattern));
}

export function run(command, args, options = {}) {
  if (command !== "gh") {
    const result = runResult(command, args, options);
    if (result.status !== 0) {
      const detail = result.stderr?.trim() || result.stdout?.trim();
      fail(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
    }
    return result.stdout;
  }

  let result = null;
  for (let attempt = 1; attempt <= GH_MAX_ATTEMPTS; attempt += 1) {
    result = runResult(command, args, options);
    if (result.status === 0) return result.stdout;
    if (!isRetryableGhFailure(result) || attempt === GH_MAX_ATTEMPTS) break;

    const detail = result.stderr?.trim() || result.stdout?.trim() || "transient GitHub API error";
    console.error(
      `Retrying gh ${args.join(" ")} after attempt ${String(attempt)} failed: ${detail}`,
    );
    sleepMilliseconds(GH_RETRY_BASE_DELAY_MS * attempt);
  }

  const detail = result?.stderr?.trim() || result?.stdout?.trim();
  fail(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
}

export function runJson(command, args, options = {}) {
  const stdout = run(command, args, options);
  try {
    return JSON.parse(stdout);
  } catch (error) {
    fail(
      `Failed to parse JSON from ${command} ${args.join(" ")}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function normalizeDiffLine(line) {
  return line.trim();
}

function normalizedSignalLength(line) {
  return line.replace(/[^A-Za-z0-9]/g, "").length;
}

export function isLowSignalLine(line) {
  if (LOW_SIGNAL_LINE_PATTERNS.some((pattern) => pattern.test(line))) return true;
  return normalizedSignalLength(line) < MIN_SIGNAL_CHARS;
}

export function isTestFile(filePath) {
  return (
    filePath.includes("/tests/") ||
    filePath.endsWith(".test.ts") ||
    filePath.endsWith(".test.tsx") ||
    filePath.endsWith(".spec.ts") ||
    filePath.endsWith(".spec.tsx")
  );
}

export function isDependencyFile(filePath) {
  return (
    filePath === "package.json" ||
    filePath.endsWith("/package.json") ||
    filePath === "pnpm-lock.yaml" ||
    filePath.startsWith("patches/")
  );
}

export function uniqueSorted(values) {
  return [...new Set(values)].toSorted((left, right) => left.localeCompare(right));
}

export function listMergedPullRequests(baseBranch, limit) {
  return runJson("gh", [
    "pr",
    "list",
    "--state",
    "merged",
    "--base",
    baseBranch,
    "--limit",
    String(limit),
    "--json",
    "number,title,mergedAt,mergeCommit",
  ]);
}

export function getPullRequest(number) {
  return runJson("gh", [
    "pr",
    "view",
    String(number),
    "--json",
    "number,title,createdAt,mergedAt,mergeCommit,baseRefName,headRefOid",
  ]);
}

export function getPullRequestFiles(number) {
  return runJson("gh", ["pr", "view", String(number), "--json", "files"]).files.map(
    ({ path }) => path,
  );
}

export function getPullRequestFileDiffs(owner, repo, number) {
  const pages = runJson("gh", [
    "api",
    "-H",
    "Accept: application/vnd.github+json",
    `repos/${owner}/${repo}/pulls/${String(number)}/files`,
    "--paginate",
    "--slurp",
  ]);

  return pages.flatMap((page) =>
    page.map((file) => ({
      path: file.filename,
      patch: file.patch ?? "",
      status: file.status,
    })),
  );
}

export function getCommitPullRequests(owner, repo, oid) {
  return runJson("gh", [
    "api",
    "-H",
    "Accept: application/vnd.github+json",
    `repos/${owner}/${repo}/commits/${oid}/pulls`,
  ])
    .filter((pullRequest) => pullRequest.merged_at)
    .map((pullRequest) => ({
      number: pullRequest.number,
      title: pullRequest.title,
      mergedAt: pullRequest.merged_at,
      mergeCommit: pullRequest.merge_commit_sha ? { oid: pullRequest.merge_commit_sha } : null,
      baseRefName: pullRequest.base?.ref ?? null,
    }));
}

export function getForcePushEvents(owner, repo, number) {
  const query = `
    query($owner:String!, $repo:String!, $num:Int!, $count:Int!) {
      repository(owner:$owner, name:$repo) {
        pullRequest(number:$num) {
          timelineItems(first:$count, itemTypes:[HEAD_REF_FORCE_PUSHED_EVENT]) {
            nodes {
              ... on HeadRefForcePushedEvent {
                createdAt
                beforeCommit { oid committedDate }
                afterCommit { oid committedDate }
              }
            }
          }
        }
      }
    }
  `;

  return runJson("gh", [
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `repo=${repo}`,
    "-F",
    `num=${String(number)}`,
    "-F",
    `count=${String(MAX_FORCE_PUSH_EVENTS)}`,
  ]).data.repository.pullRequest.timelineItems.nodes;
}

function branchRefCandidates(refName) {
  if (refName.startsWith("refs/") || refName.startsWith("origin/")) return [refName];
  return [refName, `origin/${refName}`, `refs/remotes/origin/${refName}`];
}

function resolveLocalRefOid(refName) {
  for (const candidate of branchRefCandidates(refName)) {
    const local = runResult("git", ["rev-parse", candidate]);
    if (local.status === 0) return local.stdout.trim();
  }
  return null;
}

export function getRefOid(owner, repo, refName) {
  const local = resolveLocalRefOid(refName);
  if (local) return local;

  const branchName = refName.replace(/^origin\//, "").replace(/^refs\/remotes\/origin\//, "");

  return run(
    "gh",
    ["api", `repos/${owner}/${repo}/git/ref/heads/${branchName}`, "--jq", ".object.sha"],
    {},
  ).trim();
}

export function getMergeBase(owner, repo, baseBranch, oid) {
  for (const candidate of branchRefCandidates(baseBranch)) {
    const local = runResult("git", ["merge-base", candidate, oid]);
    if (local.status === 0) return local.stdout.trim();
  }

  return run(
    "gh",
    [
      "api",
      `repos/${owner}/${repo}/compare/${baseBranch}...${oid}`,
      "--jq",
      ".merge_base_commit.sha",
    ],
    {},
  ).trim();
}

export function revListBetween(fromOid, toOid) {
  if (fromOid === toOid) return [];
  return run("git", ["rev-list", "--first-parent", "--reverse", `${fromOid}..${toOid}`])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function getMergeCommitDiff(mergeCommit, filePath) {
  return run("git", ["diff", "--unified=0", `${mergeCommit}^1`, mergeCommit, "--", filePath]);
}

export function collectChangedLines(diffText) {
  const added = new Set();
  const removed = new Set();

  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@")) continue;
    if (line.startsWith("+")) {
      const normalized = normalizeDiffLine(line.slice(1));
      if (normalized) added.add(normalized);
      continue;
    }
    if (line.startsWith("-")) {
      const normalized = normalizeDiffLine(line.slice(1));
      if (normalized) removed.add(normalized);
    }
  }

  return { added, removed };
}

export function intersectSets(left, right) {
  const values = [];
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  for (const value of smaller) {
    if (larger.has(value)) values.push(value);
  }
  return values;
}

export function subtractSetValues(values, excluded) {
  return values.filter((value) => !excluded.has(value));
}

export function sample(values, count = MAX_SAMPLE_LINES) {
  return values.slice(0, count);
}

export function getRepoSlug() {
  const url = run("git", ["remote", "get-url", "origin"]).trim();
  const httpsMatch = /^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/.exec(url);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  const sshMatch = /^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/.exec(url);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  fail(`Unsupported origin remote URL: ${url}`);
}

export function getFileContent(revision, filePath) {
  const result = runResult("git", ["show", `${revision}:${filePath}`], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) return "";
  return result.stdout;
}

export function enrichForcePushEvents(events, owner, repo, baseBranch) {
  return events
    .map((event) => {
      const beforeOid = event.beforeCommit?.oid;
      const afterOid = event.afterCommit?.oid;
      if (!beforeOid || !afterOid) return null;

      const beforeBase = getMergeBase(owner, repo, baseBranch, beforeOid);
      const afterBase = getMergeBase(owner, repo, baseBranch, afterOid);

      return {
        createdAt: event.createdAt,
        beforeOid,
        afterOid,
        beforeBase,
        afterBase,
      };
    })
    .filter(Boolean);
}

export function selectCurrentPrAnalysisWindow({ events, fallbackBase, baseHead }) {
  const advancingEvents = events
    .filter((event) => event.beforeBase !== event.afterBase)
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  const latestAdvancingEvent = advancingEvents.at(-1);

  if (latestAdvancingEvent) {
    return {
      type: "rebased-onto",
      eventCreatedAt: latestAdvancingEvent.createdAt,
      beforeBase: latestAdvancingEvent.beforeBase,
      afterBase: latestAdvancingEvent.afterBase,
    };
  }

  return {
    type: "since-merge-base",
    currentBase: fallbackBase,
    baseHead,
  };
}

export const MIN_PAIR_SIGNAL_LINES = 12;
