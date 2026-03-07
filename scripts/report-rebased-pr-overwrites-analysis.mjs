import {
  MIN_PAIR_SIGNAL_LINES,
  collectChangedLines,
  enrichForcePushEvents,
  getCommitPullRequests,
  getFileContent,
  getForcePushEvents,
  getMergeBase,
  getMergeCommitDiff,
  getPullRequest,
  getPullRequestFileDiffs,
  getPullRequestFiles,
  getRefOid,
  intersectSets,
  isDependencyFile,
  isLowSignalLine,
  isTestFile,
  listMergedPullRequests,
  revListBetween,
  sample,
  selectCurrentPrAnalysisWindow,
  subtractSetValues,
  uniqueSorted,
} from "./report-rebased-pr-overwrites-data.mjs";

function mapCandidatePullRequests(owner, repo, baseBranch, commitOids) {
  const candidates = new Map();

  for (const commitOid of commitOids) {
    const pullRequests = getCommitPullRequests(owner, repo, commitOid);
    for (const pullRequest of pullRequests) {
      if (pullRequest.baseRefName !== baseBranch) continue;
      if (!pullRequest.mergeCommit?.oid) continue;
      if (candidates.has(pullRequest.number)) continue;

      candidates.set(pullRequest.number, {
        number: pullRequest.number,
        title: pullRequest.title,
        mergedAt: pullRequest.mergedAt,
        mergeCommit: pullRequest.mergeCommit,
      });
    }
  }

  return [...candidates.values()].toSorted((left, right) =>
    left.mergedAt.localeCompare(right.mergedAt),
  );
}

function getChangedLinesForMergedPr(mergeCommitOid, filePath, changedLineCache) {
  const cacheKey = `${mergeCommitOid}:${filePath}`;
  const cached = changedLineCache.get(cacheKey);
  if (cached) return cached;

  const changedLines = collectChangedLines(getMergeCommitDiff(mergeCommitOid, filePath));
  changedLineCache.set(cacheKey, changedLines);
  return changedLines;
}

function buildLaterFileContents(revision, filePaths, fileContentCache) {
  return filePaths.map((filePath) => {
    const cacheKey = `${revision}:${filePath}`;
    const cached = fileContentCache.get(cacheKey);
    if (cached !== undefined) return { filePath, content: cached };

    const content = getFileContent(revision, filePath);
    fileContentCache.set(cacheKey, content);
    return { filePath, content };
  });
}

function analyzeOverlap({
  earlierPr,
  overlapFiles,
  getLaterChangedLines,
  laterFileContents,
  changedLineCache,
}) {
  const fileFindings = [];

  for (const filePath of overlapFiles) {
    if (isDependencyFile(filePath)) continue;

    const earlierLines = getChangedLinesForMergedPr(
      earlierPr.mergeCommit.oid,
      filePath,
      changedLineCache,
    );
    const laterLines = getLaterChangedLines(filePath);
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
        !isLowSignalLine(line) && !laterFileContents.some(({ content }) => content.includes(line)),
    );
    const removeThenAdd = removeThenAddRaw.filter(
      (line) =>
        !isLowSignalLine(line) && !laterFileContents.some(({ content }) => content.includes(line)),
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

  const nonTestFindings = fileFindings.filter((finding) => !finding.isTestFile);
  if (nonTestFindings.length === 0) return null;

  const signalLineCount = nonTestFindings.reduce(
    (sum, finding) => sum + finding.addThenRemoveCount + finding.removeThenAddCount,
    0,
  );
  if (signalLineCount < MIN_PAIR_SIGNAL_LINES) return null;

  return {
    signalLineCount,
    fileFindings: nonTestFindings,
  };
}

export function analyzeHistoricalPairs({ owner, repo, options }) {
  const mergedPrs = listMergedPullRequests(options.baseBranch, options.limit);
  const mergeCommitToPr = new Map();
  const fileCache = new Map();
  const fileContentCache = new Map();
  const changedLineCache = new Map();
  const suspiciousPairs = [];

  for (const pr of mergedPrs) {
    if (pr.mergeCommit?.oid) mergeCommitToPr.set(pr.mergeCommit.oid, pr);
  }

  for (const pr of mergedPrs) {
    const events = getForcePushEvents(owner, repo, pr.number);
    if (events.length === 0) continue;

    const enrichedEvents = enrichForcePushEvents(events, owner, repo, options.baseBranch).filter(
      (event) => event.beforeBase !== event.afterBase,
    );

    for (const event of enrichedEvents) {
      const newBaseCommits = revListBetween(event.beforeBase, event.afterBase);
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

      const laterFileContents = buildLaterFileContents(
        pr.mergeCommit.oid,
        rebasedFiles,
        fileContentCache,
      );
      const getLaterChangedLines = (filePath) =>
        getChangedLinesForMergedPr(pr.mergeCommit.oid, filePath, changedLineCache);

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

        const overlapAnalysis = analyzeOverlap({
          earlierPr: candidate,
          overlapFiles,
          getLaterChangedLines,
          laterFileContents,
          changedLineCache,
        });
        if (!overlapAnalysis) continue;

        suspiciousPairs.push({
          rebasedPr: pr,
          eventCreatedAt: event.createdAt,
          beforeBase: event.beforeBase,
          afterBase: event.afterBase,
          candidatePr: candidate,
          overlapFiles,
          signalLineCount: overlapAnalysis.signalLineCount,
          fileFindings: overlapAnalysis.fileFindings,
        });
      }
    }
  }

  return suspiciousPairs.toSorted((left, right) => right.signalLineCount - left.signalLineCount);
}

export function analyzeCurrentPrPairs({ owner, repo, options }) {
  const currentPr = getPullRequest(options.prNumber);
  const baseBranch = currentPr.baseRefName || options.baseBranch;
  const changedLineCache = new Map();
  const fileContentCache = new Map();
  const currentPrDiffs = getPullRequestFileDiffs(owner, repo, currentPr.number);
  const currentFiles = uniqueSorted(currentPrDiffs.map((file) => file.path));
  const currentDiffsByFile = new Map(
    currentPrDiffs.map((file) => [file.path, collectChangedLines(file.patch)]),
  );
  const currentFileContents = buildLaterFileContents("HEAD", currentFiles, fileContentCache);

  const rawEvents = getForcePushEvents(owner, repo, currentPr.number);
  const enrichedEvents = enrichForcePushEvents(rawEvents, owner, repo, baseBranch);
  const baseHead = getRefOid(owner, repo, baseBranch);
  const currentBase = getMergeBase(owner, repo, baseBranch, currentPr.headRefOid);
  const analysisWindow = selectCurrentPrAnalysisWindow({
    events: enrichedEvents,
    fallbackBase: currentBase,
    baseHead,
  });

  const candidateCommitOids =
    analysisWindow.type === "rebased-onto"
      ? revListBetween(analysisWindow.beforeBase, analysisWindow.afterBase)
      : revListBetween(analysisWindow.currentBase, analysisWindow.baseHead);
  const candidatePrs = mapCandidatePullRequests(
    owner,
    repo,
    baseBranch,
    candidateCommitOids,
  ).filter((candidate) => candidate.number !== currentPr.number);

  const suspiciousPairs = [];
  for (const candidate of candidatePrs) {
    const candidateFiles = uniqueSorted(getPullRequestFiles(candidate.number));
    const overlapFiles = candidateFiles.filter((file) => currentFiles.includes(file));
    if (overlapFiles.length === 0) continue;

    const overlapAnalysis = analyzeOverlap({
      earlierPr: candidate,
      overlapFiles,
      getLaterChangedLines: (filePath) =>
        currentDiffsByFile.get(filePath) ?? { added: new Set(), removed: new Set() },
      laterFileContents: currentFileContents,
      changedLineCache,
    });
    if (!overlapAnalysis) continue;

    suspiciousPairs.push({
      currentPr,
      analysisWindow,
      candidatePr: candidate,
      overlapFiles,
      signalLineCount: overlapAnalysis.signalLineCount,
      fileFindings: overlapAnalysis.fileFindings,
    });
  }

  return {
    baseBranch,
    currentPr,
    analysisWindow,
    suspiciousPairs: suspiciousPairs.toSorted(
      (left, right) => right.signalLineCount - left.signalLineCount,
    ),
  };
}
