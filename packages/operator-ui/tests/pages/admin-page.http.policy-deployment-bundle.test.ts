// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupAdminHttpPage,
  click,
  clickAndFlush,
  createAdminHttpTestCore,
  expectAuthorizedJsonRequest,
  flush,
  getByTestId,
  jsonResponse,
  renderAdminHttpConfigurePage,
  setSelectValue,
  switchHttpTab,
} from "./admin-page.http.test-support.js";
import {
  matchMutation,
  policyPageGetResponse,
  requestUrl,
} from "./admin-page.http.policy.test-support.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConfigurePage (HTTP) policy deployment bundle", () => {
  it("saves only the deployment revision bundle when effective policy includes tighter overlays", async () => {
    const { core } = createAdminHttpTestCore();
    let deploymentRevision = 7;
    let deploymentBundle = {
      v: 1 as const,
      tools: {
        default: "require_approval" as const,
        allow: ["read"],
        require_approval: [],
        deny: [],
      },
      network_egress: {
        default: "require_approval" as const,
        allow: [],
        require_approval: [],
        deny: [],
      },
      secrets: {
        default: "require_approval" as const,
        allow: [],
        require_approval: [],
        deny: [],
      },
      connectors: {
        default: "require_approval" as const,
        allow: ["telegram:*"],
        require_approval: [],
        deny: [],
      },
      artifacts: { default: "allow" as const },
      provenance: { untrusted_shell_requires_approval: true },
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";

      if (method === "GET" && url === "http://example.test/policy/bundle") {
        return jsonResponse({
          status: "ok",
          generated_at: "2026-03-01T00:00:00.000Z",
          effective: {
            sha256: `policy-sha-${deploymentRevision}`,
            bundle: {
              ...deploymentBundle,
              tools: {
                ...deploymentBundle.tools,
                deny: ["bash"],
              },
            },
            sources: {
              deployment: "shared",
              agent: "default",
              playbook: null,
            },
          },
        });
      }

      if (method === "GET" && url === "http://example.test/config/policy/deployment") {
        return jsonResponse({
          revision: deploymentRevision,
          agent_key: null,
          bundle: deploymentBundle,
          created_at: "2026-03-01T00:00:00.000Z",
          created_by: { kind: "tenant.token", token_id: "token-1" },
          reason: "seed",
          reverted_from_revision: null,
        });
      }

      if (method === "PUT" && url === "http://example.test/config/policy/deployment") {
        expectAuthorizedJsonRequest(input, init, {
          url,
          method,
          body: {
            bundle: {
              ...deploymentBundle,
              tools: {
                ...deploymentBundle.tools,
                default: "allow",
              },
            },
          },
        });
        deploymentRevision += 1;
        deploymentBundle = {
          ...deploymentBundle,
          tools: {
            ...deploymentBundle.tools,
            default: "allow",
          },
        };
        return jsonResponse({
          revision: deploymentRevision,
          agent_key: null,
          bundle: deploymentBundle,
          created_at: "2026-03-01T00:00:00.000Z",
          created_by: { kind: "tenant.token", token_id: "token-1" },
          reason: null,
          reverted_from_revision: null,
        });
      }

      const getResponse = policyPageGetResponse(input, init);
      if (getResponse) return getResponse;
      throw new Error(`Unexpected request to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-policy");
    await flush();
    await flush();

    setSelectValue(
      getByTestId<HTMLSelectElement>(page.container, "policy-config-tools-default"),
      "allow",
    );

    click(getByTestId<HTMLButtonElement>(page.container, "policy-config-save"));
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));
    await flush();
    await flush();

    expect(
      fetchMock.mock.calls.filter(([input, init]) =>
        matchMutation(
          input as RequestInfo | URL,
          init as RequestInit | undefined,
          "http://example.test/config/policy/deployment",
          "PUT",
        ),
      ),
    ).toHaveLength(1);

    cleanupAdminHttpPage(page);
  });
});
