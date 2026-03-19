export function buildGatewayArtifactUrl(httpBaseUrl: string, artifactId: string): string {
  const base = httpBaseUrl.replace(/\/$/, "");
  return `${base}/a/${encodeURIComponent(artifactId)}`;
}
