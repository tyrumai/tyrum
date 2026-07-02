export const REFINEMENT_REPO = "tyrumai/tyrum";
export const REFINEMENT_OWNER = "tyrumai";
export const REFINEMENT_PROJECT_TITLE = "Tyrum Product Refinement";
export const DEFAULT_GH = "/opt/homebrew/bin/gh";

export const VANTAGE_ROTATION = [
  "Architecture",
  "UX/UI",
  "End User",
  "Sales/GTM",
  "Reliability/Ops",
  "Security/Privacy",
  "Developer Experience",
  "Documentation",
  "Performance/Cost",
];

export const LABELS = [
  {
    name: "product-refinement",
    color: "0E8A16",
    description: "Product refinement workflow item",
  },
  {
    name: "refinement-hub",
    color: "5319E7",
    description: "Long-lived product refinement coordination issue",
  },
  {
    name: "daily-sweep",
    color: "1D76DB",
    description: "Daily product refinement sweep issue",
  },
  {
    name: "needs-refinement",
    color: "FBCA04",
    description: "Needs refinement before implementation",
  },
  {
    name: "mr-sized",
    color: "C2E0C6",
    description: "Scoped to one reviewable pull request",
  },
  {
    name: "ready-for-codex",
    color: "006B75",
    description: "Ready for Codex implementation",
  },
  {
    name: "in-codex",
    color: "BFD4F2",
    description: "Currently being handled by Codex",
  },
  {
    name: "codex-blocked",
    color: "D93F0B",
    description: "Codex is blocked and needs human input",
  },
  {
    name: "duplicate",
    color: "CCCCCC",
    description: "Duplicate or superseded refinement item",
  },
  {
    name: "escalated",
    color: "B60205",
    description: "Escalated outside normal refinement capacity",
  },
];

export const PROJECT_FIELDS = [
  { name: "Vantage", dataType: "SINGLE_SELECT", options: VANTAGE_ROTATION },
  {
    name: "Issue role",
    dataType: "SINGLE_SELECT",
    options: ["Hub", "Daily sweep", "Parent", "Child"],
  },
  { name: "Size", dataType: "SINGLE_SELECT", options: ["XS", "S", "M", "L", "XL"] },
  { name: "Priority", dataType: "SINGLE_SELECT", options: ["P0", "P1", "P2", "P3"] },
  { name: "Confidence", dataType: "SINGLE_SELECT", options: ["Low", "Medium", "High"] },
  {
    name: "Refinement state",
    dataType: "SINGLE_SELECT",
    options: [
      "Candidate",
      "Refining",
      "Ready",
      "In progress",
      "Blocked",
      "Done",
      "Duplicate",
      "Won't do",
    ],
  },
  { name: "Codex thread", dataType: "TEXT" },
  { name: "Parent issue", dataType: "NUMBER" },
  { name: "Duplicate of", dataType: "NUMBER" },
];

export const HUB_TEMPLATE = ".github/ISSUE_TEMPLATE/product-refinement-hub.md";
export const SWEEP_TEMPLATE = ".github/ISSUE_TEMPLATE/product-refinement-daily-sweep.md";

export function nextVantageFromSweeps(sweeps) {
  const latest = sweeps
    .map((issue) => issue.title ?? "")
    .find((title) => title.match(/\[Daily Sweep\]\s+\d{4}-\d{2}-\d{2}\s+-\s+(.+)$/))
    ?.match(/\[Daily Sweep\]\s+\d{4}-\d{2}-\d{2}\s+-\s+(.+)$/)?.[1];
  if (!latest) return VANTAGE_ROTATION[0];
  const index = VANTAGE_ROTATION.indexOf(latest);
  if (index < 0) return VANTAGE_ROTATION[0];
  return VANTAGE_ROTATION[(index + 1) % VANTAGE_ROTATION.length];
}

export function recordSweepInHubBody(hubBody, sweepIssue) {
  if (hubBody.includes(`#${sweepIssue.number}`)) return hubBody;
  const link = `- #${sweepIssue.number} - ${sweepIssue.title}`;
  if (hubBody.includes("## Active Daily Sweeps\n\n-")) {
    return hubBody.replace("## Active Daily Sweeps\n\n-", `## Active Daily Sweeps\n\n${link}`);
  }
  return `${hubBody.trimEnd()}\n\n## Active Daily Sweeps\n\n${link}\n`;
}

function stripTemplateFrontMatter(markdown) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
}

export function fillHubTemplate(template) {
  return stripTemplateFrontMatter(template)
    .replace("- Review frequency:", "- Review frequency: Daily at 08:30 Europe/Amsterdam")
    .replace("- Weekly comparison day:", "- Weekly comparison day: Monday")
    .replace("- Current cycle:", "- Current cycle: Initial automated rollout")
    .replace(
      "- Parent child-limit rule:",
      "- Parent child-limit rule: Review before adding more than 5 open children",
    )
    .replace(
      "- Escalation exception rule:",
      "- Escalation exception rule: Security, reliability, privacy, legal, or customer-critical findings may bypass capacity with a written reason",
    );
}

export function fillSweepTemplate(template, context) {
  return stripTemplateFrontMatter(template)
    .replace("- Date:", `- Date: ${context.date}`)
    .replace("- Vantage:", `- Vantage: ${context.vantage}`)
    .replace("- Product surface:", "- Product surface: To be determined by sweep")
    .replace("- Hub issue:", `- Hub issue: #${context.hubIssueNumber}`);
}
