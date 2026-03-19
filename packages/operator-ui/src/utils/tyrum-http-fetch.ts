import type { TyrumHttpFetch } from "@tyrum/operator-core/browser";
import { getDesktopApi } from "../desktop-api.js";

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const record: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

export function resolveTyrumHttpFetch(mode: "web" | "desktop"): TyrumHttpFetch | undefined {
  if (mode !== "desktop") return undefined;

  const api = getDesktopApi();
  const httpFetch = api?.gateway.httpFetch;
  if (!httpFetch) return undefined;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = headersToRecord(init?.headers);
    const rawBody = init?.body;
    const body =
      typeof rawBody === "string"
        ? rawBody
        : rawBody == null
          ? undefined
          : (() => {
              const kind = Object.prototype.toString.call(rawBody);
              throw new Error(
                `Desktop httpFetch only supports string request bodies (got ${kind}).`,
              );
            })();

    const result = await httpFetch({
      url,
      init: {
        method: init?.method,
        headers,
        body,
      },
    });

    return new Response(result.bodyText, {
      status: result.status,
      headers: result.headers,
    });
  };
}
