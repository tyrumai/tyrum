import { spawnSync } from "node:child_process";

const DEFAULT_LIMIT = 30;
const MAX_FORCE_PUSH_EVENTS = 100;
const MAX_SAMPLE_LINES = 5;
const MIN_SIGNAL_CHARS = 6;
const MIN_PAIR_SIGNAL_LINES = 12;
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

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    limit: DEFAULT_LIMIT,
    baseBranch: "main",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--limit") {
      const value = argv[index + 1];
      if (!value) fail("Missing value for --limit");
      const limit = Number.parseInt(value, 10);
      if (!Number.isFinite(limit) || limit <= 0) fail(`Invalid --limit value: ${value}`);
      options.limit = limit;
      index += 1;
      continue;
    }

    if (arg === "--base") {
      const value = argv[index + 1];
      if (!value) fail("Missing value for --base");
      options.baseBranch = value;
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return options;
}

function runResult(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });

  return result;
}

function run(command, args, options = {}) {
  const result = runResult(command, args, options);

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    const detail = stderr || stdout;
    fail(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }

  return result.stdout;
}

function runJson(command, args, options = {}) {
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

function isLowSignalLine(line) {
  if (LOW_SIGNAL_LINE_PATTERNS.some((pattern) => pattern.test(line))) return true;
  return normalizedSignalLength(line) < MIN_SIGNAL_CHARS;
}

function isTestFile(filePath) {
  return (
    filePath.includes("/tests/") ||
    filePath.endsWith(".test.ts") ||
    filePath.endsWith(".test.tsx") ||
    filePath.endsWith(".spec.ts") ||
    filePath.endsWith(".spec.tsx")
  );
}

function isDependencyFile(filePath) {
  return (
    filePath === "package.json" ||
    filePath.endsWith("/package.json") ||
    filePath === "pnpm-lock.yaml" ||
    filePath.startsWith("patches/")
  );
}

function uniqueSorted(values) {
  return [...new Set(values)].toSorted((left, right) => left.localeCompare(right));
}

function listMergedPullRequests(limit) {
  return runJson("gh", [
    "pr",
    "list",
    "--state",
    "merged",
    "--limit",
    String(limit),
    "--json",
    "number,title,mergedAt,mergeCommit",
  ]);
}

function getPullRequestFiles(number) {
  return runJson("gh", ["pr", "view", String(number), "--json", "files"]).files.map(
    ({ path }) => path,
  );
}

function getForcePushEvents(owner, repo, number) {
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

function getMergeBase(owner, repo, baseBranch, oid) {
  const local = runResult("git", ["merge-base", baseBranch, oid]);
  if (local.status === 0) return local.stdout.trim();

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

function revListBetween(baseBranch, fromOid, toOid) {
  if (fromOid === toOid) return [];
  return run("git", ["rev-list", "--first-parent", "--reverse", `${fromOid}..${toOid}`, baseBranch])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function getMergeCommitDiff(mergeCommit, filePath) {
  return run("git", ["diff", "--unified=0", `${mergeCommit}^1`, mergeCommit, "--", filePath]);
}

function collectChangedLines(diffText) {
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

function intersectSets(left, right) {
  const values = [];
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  for (const value of smaller) {
    if (larger.has(value)) values.push(value);
  }
  return values;
}

function subtractSetValues(values, excluded) {
  return values.filter((value) => !excluded.has(value));
}

function sample(values, count = MAX_SAMPLE_LINES) {
  return values.slice(0, count);
}

function getRepoSlug() {
  const url = run("git", ["remote", "get-url", "origin"]).trim();
  const httpsMatch = /^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/.exec(url);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  const sshMatch = /^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/.exec(url);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  fail(`Unsupported origin remote URL: ${url}`);
}

function getFileContent(mergeCommit, filePath) {
  const result = runResult("git", ["show", `${mergeCommit}:${filePath}`], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) return "";
  return result.stdout;
}

function toJsonReport({ owner, repo, options, suspiciousPairs }) {
  return {
    generatedAt: new Date().toISOString(),
    repository: {
      owner,
      repo,
    },
    baseBranch: options.baseBranch,
    limit: options.limit,
    pairCount: suspiciousPairs.length,
    pairs: suspiciousPairs.map((pair) => ({
      rewrittenPr: {
        number: pair.rebasedPr.number,
        title: pair.rebasedPr.title,
        mergedAt: pair.rebasedPr.mergedAt,
        mergeCommitOid: pair.rebasedPr.mergeCommit?.oid ?? null,
      },
      rewriteEvent: {
        createdAt: pair.eventCreatedAt,
        beforeBase: pair.beforeBase,
        afterBase: pair.afterBase,
      },
      candidateOverwrittenPr: {
        number: pair.candidatePr.number,
        title: pair.candidatePr.title,
        mergedAt: pair.candidatePr.mergedAt,
        mergeCommitOid: pair.candidatePr.mergeCommit?.oid ?? null,
      },
      signalLineCount: pair.signalLineCount,
      overlapFiles: pair.overlapFiles,
      findings: pair.fileFindings.map((finding) => ({
        filePath: finding.filePath,
        addThenRemoveCount: finding.addThenRemoveCount,
        addThenRemoveSamples: finding.addThenRemove,
        removeThenAddCount: finding.removeThenAddCount,
        removeThenAddSamples: finding.removeThenAdd,
      })),
    })),
  };
}

function printTextReport({ options, suspiciousPairs }) {
  if (suspiciousPairs.length === 0) {
    console.log(
      `No suspicious overwritten-PR pairs found in the latest ${String(options.limit)} merged PRs.`,
    );
    return;
  }

  for (const pair of suspiciousPairs) {
    console.log(
      [
        `Rewritten PR #${String(pair.rebasedPr.number)} ${pair.rebasedPr.title}`,
        `  merged: ${pair.rebasedPr.mergedAt}`,
        `  rewrite event: ${pair.eventCreatedAt}`,
        `  base advanced: ${pair.beforeBase.slice(0, 8)} -> ${pair.afterBase.slice(0, 8)}`,
        `  candidate overwritten PR: #${String(pair.candidatePr.number)} ${pair.candidatePr.title}`,
        `  candidate merged: ${pair.candidatePr.mergedAt}`,
        `  signal lines: ${String(pair.signalLineCount)}`,
        `  overlapping files (${String(pair.overlapFiles.length)}): ${pair.overlapFiles.join(", ")}`,
      ].join("\n"),
    );

    for (const finding of pair.fileFindings) {
      console.log(`  file: ${finding.filePath}`);
      if (finding.addThenRemoveCount > 0) {
        console.log(
          `    earlier added, later removed (${String(finding.addThenRemoveCount)} line match${
            finding.addThenRemoveCount === 1 ? "" : "es"
          }):`,
        );
        for (const line of finding.addThenRemove) console.log(`      - ${line}`);
      }
      if (finding.removeThenAddCount > 0) {
        console.log(
          `    earlier removed, later re-added (${String(finding.removeThenAddCount)} line match${
            finding.removeThenAddCount === 1 ? "" : "es"
          }):`,
        );
        for (const line of finding.removeThenAdd) console.log(`      - ${line}`);
      }
    }

    console.log("");
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { owner, repo } = getRepoSlug();
  const mergedPrs = listMergedPullRequests(options.limit);
  const mergeCommitToPr = new Map();
  const fileCache = new Map();
  const fileContentCache = new Map();
  const suspiciousPairs = [];

  for (const pr of mergedPrs) {
    if (pr.mergeCommit?.oid) mergeCommitToPr.set(pr.mergeCommit.oid, pr);
  }

  for (const pr of mergedPrs) {
    const events = getForcePushEvents(owner, repo, pr.number);
    if (events.length === 0) continue;

    for (const event of events) {
      const beforeOid = event.beforeCommit?.oid;
      const afterOid = event.afterCommit?.oid;
      if (!beforeOid || !afterOid) continue;

      const beforeBase = getMergeBase(owner, repo, options.baseBranch, beforeOid);
      const afterBase = getMergeBase(owner, repo, options.baseBranch, afterOid);
      if (beforeBase === afterBase) continue;

      const newBaseCommits = revListBetween(options.baseBranch, beforeBase, afterBase);
      const candidatePrs = [];
      for (const commitOid of newBaseCommits) {
        const candidate = mergeCommitToPr.get(commitOid);
        if (!candidate) continue;
        if (candidate.number === pr.number) continue;
        if (candidate.mergedAt > event.createdAt) continue;
        candidatePrs.push(candidate);
      }

      if (candidatePrs.length === 0) continue;

      const rebasedFiles =
        fileCache.get(pr.number) ??
        (() => {
          const files = uniqueSorted(getPullRequestFiles(pr.number));
          fileCache.set(pr.number, files);
          return files;
        })();

      for (const candidate of candidatePrs) {
        const candidateFiles =
          fileCache.get(candidate.number) ??
          (() => {
            const files = uniqueSorted(getPullRequestFiles(candidate.number));
            fileCache.set(candidate.number, files);
            return files;
          })();

        const overlapFiles = candidateFiles.filter((file) => rebasedFiles.includes(file));
        if (overlapFiles.length === 0) continue;

        const fileFindings = [];
        const rebasedFileContents = rebasedFiles.map((candidatePath) => {
          const fileContentKey = `${pr.mergeCommit.oid}:${candidatePath}`;
          const content =
            fileContentCache.get(fileContentKey) ??
            (() => {
              const next = getFileContent(pr.mergeCommit.oid, candidatePath);
              fileContentCache.set(fileContentKey, next);
              return next;
            })();
          return { filePath: candidatePath, content };
        });
        for (const filePath of overlapFiles) {
          if (isDependencyFile(filePath)) continue;
          const earlierLines = collectChangedLines(
            getMergeCommitDiff(candidate.mergeCommit.oid, filePath),
          );
          const laterLines = collectChangedLines(getMergeCommitDiff(pr.mergeCommit.oid, filePath));
          const movedLines = new Set(intersectSets(laterLines.added, laterLines.removed));
          const addThenRemoveRaw = subtractSetValues(
            intersectSets(earlierLines.added, laterLines.removed),
            movedLines,
          );
          const removeThenAddRaw = subtractSetValues(
            intersectSets(earlierLines.removed, laterLines.added),
            movedLines,
          );
          const addThenRemove = addThenRemoveRaw.filter(
            (line) =>
              !isLowSignalLine(line) &&
              !rebasedFileContents.some(({ content }) => content.includes(line)),
          );
          const removeThenAdd = removeThenAddRaw.filter(
            (line) =>
              !isLowSignalLine(line) &&
              !rebasedFileContents.some(({ filePath: candidatePath, content }) => {
                if (candidatePath === filePath) return false;
                return content.includes(line);
              }),
          );
          if (addThenRemove.length === 0 && removeThenAdd.length === 0) continue;

          fileFindings.push({
            filePath,
            isTestFile: isTestFile(filePath),
            addThenRemove: sample(addThenRemove),
            addThenRemoveCount: addThenRemove.length,
            removeThenAdd: sample(removeThenAdd),
            removeThenAddCount: removeThenAdd.length,
          });
        }

        if (fileFindings.length === 0) continue;
        const nonTestFindings = fileFindings.filter((finding) => !finding.isTestFile);
        if (nonTestFindings.length === 0) continue;
        const signalLineCount = nonTestFindings.reduce(
          (sum, finding) => sum + finding.addThenRemoveCount + finding.removeThenAddCount,
          0,
        );
        if (signalLineCount < MIN_PAIR_SIGNAL_LINES) continue;

        suspiciousPairs.push({
          rebasedPr: pr,
          eventCreatedAt: event.createdAt,
          beforeBase,
          afterBase,
          candidatePr: candidate,
          overlapFiles,
          signalLineCount,
          fileFindings: nonTestFindings,
        });
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(toJsonReport({ owner, repo, options, suspiciousPairs }), null, 2));
    return;
  }

  printTextReport({ options, suspiciousPairs });
}

main();
