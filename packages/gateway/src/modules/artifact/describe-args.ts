export function normalizeArtifactDescribeArgs(args: Record<string, unknown> | null): {
  artifactIds: string[];
  prompt?: string;
} {
  const single = typeof args?.["artifact_id"] === "string" ? args["artifact_id"].trim() : "";
  const many = Array.isArray(args?.["artifact_ids"])
    ? args["artifact_ids"]
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : [];
  const prompt =
    typeof args?.["prompt"] === "string" ? args["prompt"].trim() || undefined : undefined;
  return {
    artifactIds: Array.from(new Set([single, ...many].filter((value) => value.length > 0))),
    prompt,
  };
}
