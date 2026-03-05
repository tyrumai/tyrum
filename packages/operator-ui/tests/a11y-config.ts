import type AxeCore from "axe-core";

export const OPERATOR_UI_WCAG_AA_RUN_OPTIONS: AxeCore.RunOptions = {
  runOnly: {
    type: "tag",
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"],
  },
  resultTypes: ["violations", "incomplete"],
};

export function formatAxeIncompleteSummary({
  results,
  context,
}: {
  results: AxeCore.AxeResults;
  context: string;
}): string | null {
  if (!results.incomplete || results.incomplete.length === 0) return null;

  const summary = results.incomplete
    .map((result) => ({ id: result.id, nodes: result.nodes.length }))
    .toSorted((a, b) => a.id.localeCompare(b.id))
    .map(({ id, nodes }) => `${id} (${nodes})`)
    .join(", ");

  return `[axe] incomplete checks on ${context}: ${summary}`;
}
