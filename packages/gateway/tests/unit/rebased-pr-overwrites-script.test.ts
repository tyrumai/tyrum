import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseArgs,
  selectCurrentPrAnalysisWindow,
  toMarkdownReport,
} from "../../../../scripts/report-rebased-pr-overwrites.mjs";

describe("rebased PR overwrite analyzer", () => {
  it("parses current PR mode with its larger default limit", () => {
    expect(parseArgs(["--pr", "1136", "--json"])).toEqual({
      mode: "current-pr",
      limit: 100,
      baseBranch: "main",
      json: true,
      prNumber: 1136,
    });
  });

  it("prefers the latest base-advancing force-push for current PR analysis", () => {
    expect(
      selectCurrentPrAnalysisWindow({
        events: [
          {
            createdAt: "2026-03-07T10:00:00Z",
            beforeBase: "aaaaaaaa",
            afterBase: "aaaaaaaa",
          },
          {
            createdAt: "2026-03-07T11:00:00Z",
            beforeBase: "aaaaaaaa",
            afterBase: "bbbbbbbb",
          },
          {
            createdAt: "2026-03-07T12:00:00Z",
            beforeBase: "bbbbbbbb",
            afterBase: "cccccccc",
          },
        ],
        fallbackBase: "dddddddd",
        baseHead: "eeeeeeee",
      }),
    ).toEqual({
      type: "rebased-onto",
      eventCreatedAt: "2026-03-07T12:00:00Z",
      beforeBase: "bbbbbbbb",
      afterBase: "cccccccc",
    });
  });

  it("renders a concise markdown summary for advisory CI output", () => {
    expect(
      toMarkdownReport({
        mode: "current-pr",
        baseBranch: "main",
        currentPr: {
          number: 1136,
          title: "Restore automation scheduler startup wiring",
        },
        analysisWindow: {
          type: "rebased-onto",
          eventCreatedAt: "2026-03-07T12:00:00Z",
          beforeBase: "aaaaaaaa",
          afterBase: "bbbbbbbb",
        },
        pairCount: 1,
        pairs: [
          {
            candidateOverwrittenPr: {
              number: 1124,
              title: "Refine operator UI navigation",
              mergedAt: "2026-03-06T15:48:12Z",
            },
            signalLineCount: 17,
            overlapFiles: ["packages/operator-ui/src/app.tsx"],
          },
        ],
      }),
    ).toContain("#1124 Refine operator UI navigation");
  });

  it("wires the CI workflow to analyze the current pull request and upload JSON findings", () => {
    const workflowUrl = new URL("../../../../.github/workflows/ci.yml", import.meta.url);
    const workflowPath = fileURLToPath(workflowUrl);
    const workflow = readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("PR Overwrite Analyzer");
    expect(workflow).toContain("github.event_name == 'pull_request'");
    expect(workflow).toContain("issues: write");
    expect(workflow).toContain("node scripts/report-rebased-pr-overwrites.mjs");
    expect(workflow).toContain('--pr "${{ github.event.pull_request.number }}"');
    expect(workflow).toContain("pr-overwrite-analysis.json");
    expect(workflow).toContain("actions/github-script@v8");
    expect(workflow).toContain("<!-- pr-overwrite-analyzer -->");
    expect(workflow).toContain("actions/upload-artifact@v7");
  });
});
