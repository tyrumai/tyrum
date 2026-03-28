export async function createGatewayAuthCookie(input: {
  token: string;
  httpBaseUrl?: string;
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
}): Promise<Response> {
  const token = input.token.trim();
  if (!token) {
    throw new Error("Token is required");
  }

  const fetchFn = input.fetch ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("fetch is not available");
  }

  const credentials = input.credentials ?? "same-origin";
  const url = input.httpBaseUrl
    ? new URL("/auth/cookie", input.httpBaseUrl).toString()
    : "/auth/cookie";

  return await fetchFn(url, {
    method: "POST",
    credentials,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

export async function clearGatewayAuthCookie(input?: {
  httpBaseUrl?: string;
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
}): Promise<Response> {
  const fetchFn = input?.fetch ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("fetch is not available");
  }

  const credentials = input?.credentials ?? "same-origin";
  const url = input?.httpBaseUrl
    ? new URL("/auth/logout", input.httpBaseUrl).toString()
    : "/auth/logout";

  return await fetchFn(url, {
    method: "POST",
    credentials,
  });
}
