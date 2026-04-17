// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setNativeValue } from "../test-utils.js";
import {
  cleanupAdminHttpPage,
  createAdminHttpTestCore,
  flush,
  getByTestId,
  jsonResponse,
  openPolicyTab,
  renderAdminHttpConfigurePage,
  switchHttpTab,
} from "./admin-page.http.test-support.js";
import { policyPageGetResponse, requestUrl } from "./admin-page.http.policy.test-support.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConfigurePage (HTTP) policy loading + availability", () => {
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
      getByTestId<HTMLElement>(page.container, "policy-overrides-tool-metadata-alert"),
    ).not.toBe(null);
    expect(page.container.textContent).toContain("Tool metadata unavailable");
    expect(
      getByTestId<HTMLButtonElement>(page.container, "admin-policy-override-create").disabled,
    ).toBe(true);
    expect(
      getByTestId<HTMLSelectElement>(page.container, "admin-policy-override-tool").disabled,
    ).toBe(true);
    expect(
      getByTestId<HTMLSelectElement>(page.container, "admin-policy-override-tool-filter").disabled,
    ).toBe(true);

    cleanupAdminHttpPage(page);
  });

  it("surfaces shared tool metadata drift instead of silently treating it as an empty registry", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        throw new Error(`Unexpected ${method} request to ${url}`);
      }
      if (url.startsWith("http://example.test/policy/overrides")) {
        return jsonResponse({
          overrides: [
            {
              policy_override_id: "00000000-0000-4000-8000-000000000101",
              status: "active",
              created_at: "2026-03-01T00:00:00.000Z",
              agent_id: "00000000-0000-4000-8000-000000000002",
              tool_id: "tool.fs.read",
              pattern: "docs/*",
            },
          ],
        });
      }
      if (url === "http://example.test/config/tools") {
        return jsonResponse({
          status: "ok",
          tools: [
            {
              source: "builtin",
              canonical_id: "read",
              description: "Read files from disk.",
              effect: "read_only",
              effective_exposure: {
                enabled: true,
                reason: "enabled",
                agent_key: "default",
              },
            },
          ],
        });
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

    await act(async () => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "admin-policy-override-pattern"),
        "docs/*",
      );
      await Promise.resolve();
    });

    expect(
      getByTestId<HTMLElement>(page.container, "policy-overrides-tool-metadata-alert"),
    ).not.toBe(null);
    expect(page.container.textContent).toContain("Tool metadata unavailable");
    const rowSummary = getByTestId<HTMLElement>(
      page.container,
      "policy-override-tool-summary-00000000-0000-4000-8000-000000000101",
    );
    expect(rowSummary.textContent).toContain("Metadata unavailable");
    expect(rowSummary.textContent).toContain("Saved tool ID:");
    expect(rowSummary.textContent).toContain("read");
    expect(page.container.textContent).toContain(
      "Shared tool metadata from /config/tools is unavailable or invalid.",
    );
    expect(
      getByTestId<HTMLButtonElement>(page.container, "admin-policy-override-create").disabled,
    ).toBe(true);
    expect(
      getByTestId<HTMLSelectElement>(page.container, "admin-policy-override-tool").disabled,
    ).toBe(true);
    expect(
      getByTestId<HTMLSelectElement>(page.container, "admin-policy-override-tool-filter").disabled,
    ).toBe(true);
    expect(page.container.textContent).not.toContain("Policy tab failed to load");

    cleanupAdminHttpPage(page);
  });

  it("keeps Policy and Overrides available when deployment config routes are absent", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        throw new Error(`Unexpected ${method} request to ${url}`);
      }
      if (url === "http://example.test/config/policy/deployment") {
        return jsonResponse({ error: "not_found", message: "route not found" }, 404);
      }
      if (url === "http://example.test/config/policy/deployment/revisions") {
        return jsonResponse({ error: "not_found", message: "route not found" }, 404);
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
    expect(page.container.textContent).not.toContain("Overrides failed to load");
    expect(page.container.textContent).toContain("Deployment policy editing unavailable");
    expect(getByTestId<HTMLButtonElement>(page.container, "policy-config-save").disabled).toBe(
      true,
    );
    expect(
      getByTestId<HTMLButtonElement>(page.container, "admin-policy-overrides-refresh"),
    ).not.toBeNull();

    cleanupAdminHttpPage(page);
  });

  it("retries policy loading when elevated mode enables the admin client after mount", async () => {
    const { core } = createAdminHttpTestCore();
    core.elevatedModeStore.exit();
    delete (core.admin as { policyConfig?: unknown }).policyConfig;

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
});
