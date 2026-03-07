import {
  analyzeCurrentPrPairs,
  analyzeHistoricalPairs,
} from "./report-rebased-pr-overwrites-analysis.mjs";
import { getRepoSlug, parseArgs, sample } from "./report-rebased-pr-overwrites-data.mjs";

function toPairFindings(pair) {
  return pair.fileFindings.map((finding) => ({
    filePath: finding.filePath,
    addThenRemoveCount: finding.addThenRemoveCount,
    addThenRemoveSamples: finding.addThenRemove,
    removeThenAddCount: finding.removeThenAddCount,
    removeThenAddSamples: finding.removeThenAdd,
  }));
}

function toHistoricalJsonReport({ owner, repo, options, suspiciousPairs }) {
  return {
    generatedAt: new Date().toISOString(),
    repository: { owner, repo },
    mode: "history",
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
      findings: toPairFindings(pair),
    })),
  };
}

function toCurrentPrJsonReport({
  owner,
  repo,
  currentPr,
  baseBranch,
  analysisWindow,
  suspiciousPairs,
}) {
  return {
    generatedAt: new Date().toISOString(),
    repository: { owner, repo },
    mode: "current-pr",
    baseBranch,
    currentPr: {
      number: currentPr.number,
      title: currentPr.title,
      createdAt: currentPr.createdAt,
      headRefOid: currentPr.headRefOid,
    },
    analysisWindow,
    pairCount: suspiciousPairs.length,
    pairs: suspiciousPairs.map((pair) => ({
      candidateOverwrittenPr: {
        number: pair.candidatePr.number,
        title: pair.candidatePr.title,
        mergedAt: pair.candidatePr.mergedAt,
        mergeCommitOid: pair.candidatePr.mergeCommit?.oid ?? null,
      },
      signalLineCount: pair.signalLineCount,
      overlapFiles: pair.overlapFiles,
      findings: toPairFindings(pair),
    })),
  };
}

function formatWindowSummary(report) {
  if (report.mode !== "current-pr") return "";

  if (report.analysisWindow.type === "rebased-onto") {
    return `Latest base-advancing force-push at ${report.analysisWindow.eventCreatedAt} (${report.analysisWindow.beforeBase.slice(0, 8)} -> ${report.analysisWindow.afterBase.slice(0, 8)})`;
  }

  return `No base-advancing force-push found; comparing merged PRs from merge-base ${report.analysisWindow.currentBase.slice(0, 8)} up to ${report.analysisWindow.baseHead.slice(0, 8)}`;
}

export function toMarkdownReport(report) {
  const lines = ["## PR Overwrite Analyzer", ""];

  if (report.mode === "current-pr") {
    lines.push(`Target PR: #${String(report.currentPr.number)} ${report.currentPr.title}`);
    lines.push(`Base branch: \`${report.baseBranch}\``);
    lines.push(formatWindowSummary(report));
    lines.push("");
  } else {
    lines.push(
      `Historical scan of the latest ${String(report.limit)} merged PRs on \`${report.baseBranch}\`.`,
    );
    lines.push("");
  }

  if (report.pairCount === 0) {
    lines.push("No likely overwritten merged PRs detected.");
    return `${lines.join("\n")}\n`;
  }

  lines.push(`Detected ${String(report.pairCount)} likely overwrite pair(s).`);
  lines.push("");

  for (const pair of report.pairs) {
    const candidatePr = pair.candidateOverwrittenPr;
    const filesPreview = sample(pair.overlapFiles, 3).join(", ");
    lines.push(
      `- #${String(candidatePr.number)} ${candidatePr.title} (${String(pair.signalLineCount)} signal lines across ${String(pair.overlapFiles.length)} overlapping file${pair.overlapFiles.length === 1 ? "" : "s"})`,
    );
    lines.push(`  Merged: ${candidatePr.mergedAt}`);
    lines.push(`  Files: ${filesPreview}${pair.overlapFiles.length > 3 ? ", ..." : ""}`);
  }

  lines.push("");
  lines.push("Full findings are attached in the JSON artifact.");
  return `${lines.join("\n")}\n`;
}

function printTextReport(report) {
  if (report.mode === "current-pr") {
    console.log(
      `Current PR #${String(report.currentPr.number)} ${report.currentPr.title}\n  base: ${report.baseBranch}\n  ${formatWindowSummary(report)}`,
    );
    if (report.pairCount === 0) {
      console.log("\nNo likely overwritten merged PRs detected.");
      return;
    }

    console.log("");
    for (const pair of report.pairs) {
      console.log(
        [
          `Candidate overwritten PR: #${String(pair.candidateOverwrittenPr.number)} ${pair.candidateOverwrittenPr.title}`,
          `  merged: ${pair.candidateOverwrittenPr.mergedAt}`,
          `  signal lines: ${String(pair.signalLineCount)}`,
          `  overlapping files (${String(pair.overlapFiles.length)}): ${pair.overlapFiles.join(", ")}`,
        ].join("\n"),
      );

      for (const finding of pair.findings) {
        console.log(`  file: ${finding.filePath}`);
        if (finding.addThenRemoveCount > 0) {
          console.log(
            `    earlier added, later removed (${String(finding.addThenRemoveCount)} line match${
              finding.addThenRemoveCount === 1 ? "" : "es"
            }):`,
          );
          for (const line of finding.addThenRemoveSamples) console.log(`      - ${line}`);
        }
        if (finding.removeThenAddCount > 0) {
          console.log(
            `    earlier removed, later re-added (${String(finding.removeThenAddCount)} line match${
              finding.removeThenAddCount === 1 ? "" : "es"
            }):`,
          );
          for (const line of finding.removeThenAddSamples) console.log(`      - ${line}`);
        }
      }
      console.log("");
    }
    return;
  }

  if (report.pairCount === 0) {
    console.log(
      `No suspicious overwritten-PR pairs found in the latest ${String(report.limit)} merged PRs.`,
    );
    return;
  }

  for (const pair of report.pairs) {
    console.log(
      [
        `Rewritten PR #${String(pair.rewrittenPr.number)} ${pair.rewrittenPr.title}`,
        `  merged: ${pair.rewrittenPr.mergedAt}`,
        `  rewrite event: ${pair.rewriteEvent.createdAt}`,
        `  base advanced: ${pair.rewriteEvent.beforeBase.slice(0, 8)} -> ${pair.rewriteEvent.afterBase.slice(0, 8)}`,
        `  candidate overwritten PR: #${String(pair.candidateOverwrittenPr.number)} ${pair.candidateOverwrittenPr.title}`,
        `  candidate merged: ${pair.candidateOverwrittenPr.mergedAt}`,
        `  signal lines: ${String(pair.signalLineCount)}`,
        `  overlapping files (${String(pair.overlapFiles.length)}): ${pair.overlapFiles.join(", ")}`,
      ].join("\n"),
    );

    for (const finding of pair.findings) {
      console.log(`  file: ${finding.filePath}`);
      if (finding.addThenRemoveCount > 0) {
        console.log(
          `    earlier added, later removed (${String(finding.addThenRemoveCount)} line match${
            finding.addThenRemoveCount === 1 ? "" : "es"
          }):`,
        );
        for (const line of finding.addThenRemoveSamples) console.log(`      - ${line}`);
      }
      if (finding.removeThenAddCount > 0) {
        console.log(
          `    earlier removed, later re-added (${String(finding.removeThenAddCount)} line match${
            finding.removeThenAddCount === 1 ? "" : "es"
          }):`,
        );
        for (const line of finding.removeThenAddSamples) console.log(`      - ${line}`);
      }
    }
    console.log("");
  }
}

export function main() {
  const options = parseArgs(process.argv.slice(2));
  const { owner, repo } = getRepoSlug();

  if (options.mode === "current-pr") {
    const { currentPr, baseBranch, analysisWindow, suspiciousPairs } = analyzeCurrentPrPairs({
      owner,
      repo,
      options,
    });
    const report = toCurrentPrJsonReport({
      owner,
      repo,
      currentPr,
      baseBranch,
      analysisWindow,
      suspiciousPairs,
    });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    printTextReport(report);
    return;
  }

  const suspiciousPairs = analyzeHistoricalPairs({ owner, repo, options });
  const report = toHistoricalJsonReport({ owner, repo, options, suspiciousPairs });
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printTextReport(report);
}
