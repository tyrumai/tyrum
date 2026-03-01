export function buildGatewayArtifactUrl(
  httpBaseUrl: string,
  runId: string,
  artifactId: string,
): string {
  const base = httpBaseUrl.replace(/\/$/, "");
  return `${base}/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`;
}
