export function requestIdForAudit(c: {
  req: { header(name: string): string | undefined };
  res: { headers: { get(name: string): string | null } };
}): string | undefined {
  const fromRequest = c.req.header("x-request-id")?.trim();
  if (fromRequest) return fromRequest;
  const fromResponse = c.res.headers.get("x-request-id")?.trim();
  if (fromResponse) return fromResponse;
  return undefined;
}

