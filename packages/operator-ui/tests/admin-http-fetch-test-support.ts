import type { OperatorCore } from "../../operator-core/src/index.js";
import { vi } from "vitest";

type AdminHttpReadCore = Pick<OperatorCore, "http" | "httpBaseUrl">;
type AdminHttpWriteHandler = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  context: { method: string; requestUrl: URL; url: string },
) => Promise<Response | undefined> | Response | undefined;

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function parseOptionalInt(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function routeAdminReadRequest(
  core: AdminHttpReadCore,
  requestUrl: URL,
  method: string,
): Promise<Response | undefined> {
  if (method !== "GET") return undefined;

  switch (requestUrl.pathname) {
    case "/agent/list":
      return jsonResponse(
        await core.http.agentList.get({
          include_default:
            requestUrl.searchParams.get("include_default") === null
              ? undefined
              : requestUrl.searchParams.get("include_default") === "true",
        }),
      );
    case "/config/agents/default":
      return jsonResponse(await core.http.agentConfig.get("default"));
    case "/config/models/assignments":
      return jsonResponse(await core.http.modelConfig.listAssignments());
    case "/config/models/presets":
      return jsonResponse(await core.http.modelConfig.listPresets());
    case "/config/models/presets/available":
      return jsonResponse(await core.http.modelConfig.listAvailable());
    case "/config/policy/deployment":
      return jsonResponse(await core.http.policyConfig.getDeployment());
    case "/config/policy/deployment/revisions":
      return jsonResponse(await core.http.policyConfig.listDeploymentRevisions());
    case "/config/providers":
      return jsonResponse(await core.http.providerConfig.listProviders());
    case "/config/providers/registry":
      return jsonResponse(await core.http.providerConfig.listRegistry());
    case "/config/channels":
      return core.http.channelConfig
        ? jsonResponse(await core.http.channelConfig.listChannels())
        : undefined;
    case "/config/channels/registry":
      return core.http.channelConfig
        ? jsonResponse(await core.http.channelConfig.listRegistry())
        : undefined;
    case "/config/tools":
      return jsonResponse(await core.http.toolRegistry.list());
    case "/policy/bundle":
      return jsonResponse(await core.http.policy.getBundle());
    case "/policy/overrides":
      return jsonResponse(
        await core.http.policy.listOverrides({
          limit: parseOptionalInt(requestUrl.searchParams.get("limit")),
        }),
      );
    case "/routing/channels/configs":
      return jsonResponse(await core.http.routingConfig.listChannelConfigs());
    case "/routing/channels/telegram/threads":
      return jsonResponse(
        await core.http.routingConfig.listObservedTelegramThreads({
          limit: parseOptionalInt(requestUrl.searchParams.get("limit")),
        }),
      );
    case "/routing/config":
      return jsonResponse(await core.http.routingConfig.get());
    case "/routing/config/revisions":
      return jsonResponse(
        await core.http.routingConfig.listRevisions({
          limit: parseOptionalInt(requestUrl.searchParams.get("limit")),
        }),
      );
    case "/secrets":
      return jsonResponse(
        await core.http.secrets.list({
          agent_key: requestUrl.searchParams.get("agent_key") ?? undefined,
        }),
      );
    default:
      if (requestUrl.pathname === "/agents") {
        return jsonResponse(await core.http.agents.list());
      }
      if (requestUrl.pathname.startsWith("/config/agents/")) {
        const agentKey = decodeURIComponent(requestUrl.pathname.slice("/config/agents/".length));
        return jsonResponse(await core.http.agentConfig.get(agentKey));
      }
      return undefined;
  }
}

export function stubAdminHttpFetch(
  core: AdminHttpReadCore,
  writeHandler?: AdminHttpWriteHandler,
): {
  fetchMock: ReturnType<typeof vi.fn>;
  writeSpy: ReturnType<typeof vi.fn>;
} {
  const writeSpy = vi.fn(writeHandler ?? (() => undefined));
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = new URL(getRequestUrl(input), core.httpBaseUrl);
    const method = init?.method ?? "GET";
    const readResponse = await routeAdminReadRequest(core, requestUrl, method);
    if (readResponse) {
      return readResponse;
    }

    const writeResponse = await writeSpy(input, init, {
      method,
      requestUrl,
      url: requestUrl.toString(),
    });
    if (writeResponse) {
      return writeResponse;
    }

    throw new Error(`Unexpected fetch request: ${method} ${requestUrl.toString()}`);
  });

  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return { fetchMock, writeSpy };
}
