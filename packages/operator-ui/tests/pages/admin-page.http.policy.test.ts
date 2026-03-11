// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setNativeValue } from "../test-utils.js";
import {
  cleanupAdminHttpPage,
  click,
  clickAndFlush,
  createAdminHttpTestCore,
  expectAuthorizedJsonRequest,
  flush,
  getByTestId,
  jsonResponse,
  openPolicyTab,
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

describe("ConfigurePage (HTTP) policy + config", () => {
  it("renders Policy, Providers, and Models panels when Elevated Mode is active", async () => {
    const { core } = createAdminHttpTestCore();
    const page = renderAdminHttpConfigurePage(core);

    await switchHttpTab(page.container, "admin-http-tab-policy");
    expect(page.container.querySelector("[data-testid='admin-http-policy']")).not.toBeNull();

    await switchHttpTab(page.container, "admin-http-tab-providers");
    expect(page.container.querySelector("[data-testid='admin-http-providers']")).not.toBeNull();

    await switchHttpTab(page.container, "admin-http-tab-models");
    expect(page.container.querySelector("[data-testid='admin-http-models']")).not.toBeNull();

    cleanupAdminHttpPage(page);
  });

  it("disables policy override creation until required structured fields are set", async () => {
    const { core } = createAdminHttpTestCore();
    core.elevatedModeStore.exit();

    const page = renderAdminHttpConfigurePage(core);

    openPolicyTab(page.container);
    await flush();
    await flush();

    expect(
      getByTestId<HTMLButtonElement>(page.container, "admin-policy-override-create").disabled,
    ).toBe(true);

    setSelectValue(
      getByTestId<HTMLSelectElement>(page.container, "admin-policy-override-agent"),
      "00000000-0000-4000-8000-000000000002",
    );
    setSelectValue(
      getByTestId<HTMLSelectElement>(page.container, "admin-policy-override-tool"),
      "read",
    );
    await act(async () => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "admin-policy-override-pattern"),
        "read:*",
      );
      await Promise.resolve();
    });

    expect(
      getByTestId<HTMLButtonElement>(page.container, "admin-policy-override-create").disabled,
    ).toBe(false);

    cleanupAdminHttpPage(page);
  });

  it("does not show unsaved changes when the effective bundle omits optional domains", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        throw new Error(`Unexpected ${method} request to ${url}`);
      }
      if (url === "http://example.test/policy/bundle") {
        return jsonResponse({
          status: "ok",
          generated_at: "2026-03-01T00:00:00.000Z",
          effective: {
            sha256: "policy-sha-sparse",
            bundle: { v: 1 },
            sources: { deployment: "default", agent: null, playbook: null },
          },
        });
      }
      if (url === "http://example.test/config/policy/deployment") {
        return jsonResponse({ error: "not_found", message: "policy bundle config not found" }, 404);
      }
      if (url === "http://example.test/config/policy/deployment/revisions") {
        return jsonResponse({ revisions: [] });
      }
      if (url.startsWith("http://example.test/policy/overrides")) {
        return jsonResponse({ overrides: [] });
      }
      if (url === "http://example.test/agents") {
        return jsonResponse({ agents: [] });
      }
      if (url === "http://example.test/config/tools") {
        return jsonResponse({ status: "ok", tools: [] });
      }
      throw new Error(`Unexpected request to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-policy");
    await flush();
    await flush();

    expect(page.container.textContent).toContain("No unsaved changes");
    expect(getByTestId<HTMLButtonElement>(page.container, "policy-config-save").disabled).toBe(
      true,
    );

    cleanupAdminHttpPage(page);
  });

  it("shows the initial policy load failure only once", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        throw new Error(`Unexpected ${method} request to ${url}`);
      }
      if (url === "http://example.test/policy/bundle") {
        throw new Error("initial policy load failed");
      }
      const response = policyPageGetResponse(input, init);
      if (response) return response;
      throw new Error(`Unexpected request to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-policy");
    await flush();
    await flush();

    expect(page.container.textContent?.match(/Policy tab failed to load/g)).toHaveLength(1);

    cleanupAdminHttpPage(page);
  });

  it("keeps the policy tab available when auxiliary agent and tool registry calls fail", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        throw new Error(`Unexpected ${method} request to ${url}`);
      }
      if (url === "http://example.test/agents") {
        throw new Error("agents unavailable");
      }
      if (url === "http://example.test/config/tools") {
        throw new Error("tool registry unavailable");
      }
      const response = policyPageGetResponse(input, init);
      if (response) return response;
      throw new Error(`Unexpected request to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-policy");
    await flush();
    await flush();

    expect(page.container.textContent).not.toContain("Policy tab failed to load");
    expect(getByTestId<HTMLElement>(page.container, "policy-config-save-card")).not.toBeNull();
    expect(
      getByTestId<HTMLButtonElement>(page.container, "admin-policy-override-create").disabled,
    ).toBe(true);

    cleanupAdminHttpPage(page);
  });

  it("retries policy loading when elevated mode enables the admin client after mount", async () => {
    const { core } = createAdminHttpTestCore();
    core.elevatedModeStore.exit();
    delete (core.http as { policyConfig?: unknown }).policyConfig;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = policyPageGetResponse(input, init);
      if (response) return response;
      throw new Error(`Unexpected request to ${requestUrl(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    openPolicyTab(page.container);
    await flush();
    await flush();

    expect(page.container.textContent).toContain("Policy tab failed to load");
    expect(page.container.textContent).toContain("Deployment policy config API unavailable.");

    act(() => {
      core.elevatedModeStore.enter({
        elevatedToken: "test-elevated-token",
        expiresAt: "2026-03-01T00:01:00.000Z",
      });
    });
    await flush();
    await flush();

    expect(page.container.textContent).not.toContain("Policy tab failed to load");
    expect(getByTestId<HTMLElement>(page.container, "policy-config-save-card")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalled();

    cleanupAdminHttpPage(page);
  });

  it("keeps the policy editor visible when refresh fails after an initial successful load", async () => {
    const { core } = createAdminHttpTestCore();
    let policyBundleRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        throw new Error(`Unexpected ${method} request to ${url}`);
      }
      if (url === "http://example.test/policy/bundle") {
        policyBundleRequests += 1;
        if (policyBundleRequests === 1) {
          return jsonResponse({
            status: "ok",
            generated_at: "2026-03-01T00:00:00.000Z",
            effective: {
              sha256: "policy-sha-1",
              bundle: {
                v: 1,
                tools: {
                  default: "require_approval",
                  allow: ["read"],
                  require_approval: [],
                  deny: [],
                },
                network_egress: {
                  default: "require_approval",
                  allow: [],
                  require_approval: [],
                  deny: [],
                },
                secrets: {
                  default: "require_approval",
                  allow: [],
                  require_approval: [],
                  deny: [],
                },
                connectors: {
                  default: "require_approval",
                  allow: ["telegram:*"],
                  require_approval: [],
                  deny: [],
                },
                artifacts: { default: "allow" },
                provenance: { untrusted_shell_requires_approval: true },
              },
              sources: { deployment: "default", agent: null, playbook: null },
            },
          });
        }
        throw new Error("refresh failed");
      }
      const response = policyPageGetResponse(input, init);
      if (response) return response;
      throw new Error(`Unexpected request to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-policy");
    await flush();
    await flush();

    const toolsDefault = getByTestId<HTMLSelectElement>(
      page.container,
      "policy-config-tools-default",
    );
    setSelectValue(toolsDefault, "allow");
    expect(toolsDefault.value).toBe("allow");

    await clickAndFlush(getByTestId<HTMLButtonElement>(page.container, "policy-config-refresh"));
    await flush();
    await flush();

    expect(page.container.textContent).not.toContain("Policy tab failed to load");
    expect(page.container.textContent).toContain("Policy history failed to load");
    expect(getByTestId<HTMLElement>(page.container, "policy-config-save-card")).not.toBeNull();
    expect(
      getByTestId<HTMLSelectElement>(page.container, "policy-config-tools-default").value,
    ).toBe("allow");

    cleanupAdminHttpPage(page);
  });

  it("saves deployment policy revisions from structured controls", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const getResponse = policyPageGetResponse(input, init);
      if (getResponse) return getResponse;
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/config/policy/deployment",
        method: "PUT",
        body: {
          bundle: {
            v: 1,
            tools: {
              default: "allow",
              allow: ["read"],
              require_approval: [],
              deny: [],
            },
            network_egress: {
              default: "require_approval",
              allow: [],
              require_approval: [],
              deny: [],
            },
            secrets: {
              default: "require_approval",
              allow: [],
              require_approval: [],
              deny: [],
            },
            connectors: {
              default: "require_approval",
              allow: ["telegram:*"],
              require_approval: [],
              deny: [],
            },
            artifacts: { default: "allow" },
            provenance: { untrusted_shell_requires_approval: true },
          },
          reason: "Tighten nothing yet",
        },
      });
      return jsonResponse(
        {
          revision: 1,
          bundle: {
            v: 1,
            tools: { default: "allow", allow: ["read"], require_approval: [], deny: [] },
          },
          created_at: "2026-03-01T00:00:00.000Z",
          created_by: { kind: "tenant.token", token_id: "token-1" },
          reason: "Tighten nothing yet",
          reverted_from_revision: null,
        },
        200,
      );
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
    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "policy-config-save-reason"),
        "Tighten nothing yet",
      );
    });

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

  it("requires confirmation before creating policy overrides", async () => {
    const { core, policyCreateOverride } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const getResponse = policyPageGetResponse(input, init);
      if (getResponse) return getResponse;
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/policy/overrides",
        method: "POST",
        body: {
          agent_id: "00000000-0000-4000-8000-000000000002",
          tool_id: "read",
          pattern: "docs/*",
        },
      });
      return jsonResponse(
        {
          override: {
            policy_override_id: "00000000-0000-0000-0000-000000000001",
            status: "active",
            created_at: "2026-03-01T00:00:00.000Z",
            agent_id: "00000000-0000-4000-8000-000000000002",
            tool_id: "read",
            pattern: "docs/*",
          },
        },
        201,
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-policy");
    await flush();
    await flush();

    setSelectValue(
      getByTestId<HTMLSelectElement>(page.container, "admin-policy-override-agent"),
      "00000000-0000-4000-8000-000000000002",
    );
    setSelectValue(
      getByTestId<HTMLSelectElement>(page.container, "admin-policy-override-tool"),
      "read",
    );
    await act(async () => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "admin-policy-override-pattern"),
        "docs/*",
      );
      await Promise.resolve();
    });

    click(getByTestId<HTMLButtonElement>(page.container, "admin-policy-override-create"));

    expect(policyCreateOverride).toHaveBeenCalledTimes(0);
    expect(
      fetchMock.mock.calls.filter(([input, init]) =>
        matchMutation(
          input as RequestInfo | URL,
          init as RequestInit | undefined,
          "http://example.test/policy/overrides",
          "POST",
        ),
      ),
    ).toHaveLength(0);

    const confirmButton = getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm");
    expect(confirmButton.disabled).toBe(true);

    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    expect(confirmButton.disabled).toBe(false);

    await clickAndFlush(confirmButton);

    expect(policyCreateOverride).toHaveBeenCalledTimes(0);
    expect(
      fetchMock.mock.calls.filter(([input, init]) =>
        matchMutation(
          input as RequestInfo | URL,
          init as RequestInit | undefined,
          "http://example.test/policy/overrides",
          "POST",
        ),
      ),
    ).toHaveLength(1);
    cleanupAdminHttpPage(page);
  });
});
