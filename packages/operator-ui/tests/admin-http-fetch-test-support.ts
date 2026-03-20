import type { OperatorCore } from "../../operator-app/src/index.js";
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

  if (requestUrl.pathname.startsWith("/config/agents/")) {
    const agentKey = decodeURIComponent(requestUrl.pathname.slice("/config/agents/".length));
    return jsonResponse(await core.admin.agentConfig.get(agentKey));
  }
  if (requestUrl.pathname.startsWith("/config/policy/agents/")) {
    const path = requestUrl.pathname.slice("/config/policy/agents/".length);
    const [encodedAgentKey, suffix] = path.split("/", 2);
    const agentKey = decodeURIComponent(encodedAgentKey ?? "");
    if (suffix === "revisions") {
      return jsonResponse(await core.admin.policyConfig.listAgentRevisions(agentKey));
    }
    return jsonResponse(await core.admin.policyConfig.getAgent(agentKey));
  }

  switch (requestUrl.pathname) {
    case "/agent/list":
      return jsonResponse(
        await core.admin.agentList.get({
          include_default:
            requestUrl.searchParams.get("include_default") === null
              ? undefined
              : requestUrl.searchParams.get("include_default") === "true",
        }),
      );
    case "/config/models/assignments":
      return jsonResponse(await core.admin.modelConfig.listAssignments());
    case "/config/models/presets":
      return jsonResponse(await core.admin.modelConfig.listPresets());
    case "/config/models/presets/available":
      return jsonResponse(await core.admin.modelConfig.listAvailable());
    case "/config/policy/deployment":
      return jsonResponse(await core.admin.policyConfig.getDeployment());
    case "/config/policy/deployment/revisions":
      return jsonResponse(await core.admin.policyConfig.listDeploymentRevisions());
    case "/config/providers":
      return jsonResponse(await core.admin.providerConfig.listProviders());
    case "/config/providers/registry":
      return jsonResponse(await core.admin.providerConfig.listRegistry());
    case "/config/channels":
      return core.admin.channelConfig
        ? jsonResponse(await core.admin.channelConfig.listChannels())
        : undefined;
    case "/config/channels/registry":
      return core.admin.channelConfig
        ? jsonResponse(await core.admin.channelConfig.listRegistry())
        : undefined;
    case "/config/tools":
      return jsonResponse(await core.admin.toolRegistry.list());
    case "/policy/bundle":
      return jsonResponse(await core.admin.policy.getBundle());
    case "/policy/overrides":
      return jsonResponse(
        await core.admin.policy.listOverrides({
          limit: parseOptionalInt(requestUrl.searchParams.get("limit")),
        }),
      );
    case "/routing/channels/configs":
      return jsonResponse(await core.admin.routingConfig.listChannelConfigs());
    case "/routing/channels/telegram/threads":
      return jsonResponse(
        await core.admin.routingConfig.listObservedTelegramThreads({
          limit: parseOptionalInt(requestUrl.searchParams.get("limit")),
        }),
      );
    case "/routing/config":
      return jsonResponse(await core.admin.routingConfig.get());
    case "/routing/config/revisions":
      return jsonResponse(
        await core.admin.routingConfig.listRevisions({
          limit: parseOptionalInt(requestUrl.searchParams.get("limit")),
        }),
      );
    case "/secrets":
      return jsonResponse(
        await core.admin.secrets.list({
          agent_key: requestUrl.searchParams.get("agent_key") ?? undefined,
        }),
      );
    default:
      if (requestUrl.pathname === "/agents") {
        return jsonResponse(await core.admin.agents.list());
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
