export function resolveApiBaseUrl(): string | undefined {
  const fromEnv =
    process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? undefined;
  if (!fromEnv) {
    return undefined;
  }
  return fromEnv.replace(/\/$/, "");
}

export async function parseUpstreamResponse(response: Response) {
  const raw = await response.text();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
}
