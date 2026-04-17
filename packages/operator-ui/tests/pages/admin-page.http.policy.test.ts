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
  waitForTestId,
} from "./admin-page.http.test-support.js";
import {
  matchMutation,
  policyPageGetResponse,
  policyPageWritableConfigGetResponse,
  requestUrl,
} from "./admin-page.http.policy.test-support.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConfigurePage (HTTP) policy + config", () => {
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

    click(getByTestId<HTMLButtonElement>(page.container, "policy-config-tools-allow-add"));
    setSelectValue(
      getByTestId<HTMLSelectElement>(page.container, "policy-config-tools-allow-select-0"),
      "__custom__",
    );
    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "policy-config-tools-allow-row-0"),
        "tool.fs.*",
      );
    });
    expect(
      getByTestId<HTMLInputElement>(page.container, "policy-config-tools-allow-row-0").value,
    ).toBe("tool.fs.*");

    await clickAndFlush(getByTestId<HTMLButtonElement>(page.container, "policy-config-refresh"));
    await flush();
    await flush();

    expect(page.container.textContent).not.toContain("Policy tab failed to load");
    expect(page.container.textContent).toContain("Policy history failed to load");
    expect(getByTestId<HTMLElement>(page.container, "policy-config-save-card")).not.toBeNull();
    expect(
      getByTestId<HTMLInputElement>(page.container, "policy-config-tools-allow-row-0").value,
    ).toBe("tool.fs.*");

    cleanupAdminHttpPage(page);
  });

  it("saves deployment policy revisions from structured controls", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const writableConfigResponse = policyPageWritableConfigGetResponse(input, init);
      if (writableConfigResponse) return writableConfigResponse;
      const getResponse = policyPageGetResponse(input, init);
      if (getResponse) return getResponse;
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/config/policy/deployment",
        method: "PUT",
        body: {
          bundle: {
            v: 1,
            tools: {
              allow: ["glob"],
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
            tools: { allow: ["glob"], require_approval: [], deny: [] },
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
      getByTestId<HTMLSelectElement>(page.container, "policy-config-tools-allow-select-0"),
      "glob",
    );
    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "policy-config-save-reason"),
        "Tighten nothing yet",
      );
    });

    click(getByTestId<HTMLButtonElement>(page.container, "policy-config-save"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-dialog-confirm"));
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

  it("renders canonical tool metadata in override inventory filters and revoke confirmation", async () => {
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
            {
              policy_override_id: "00000000-0000-4000-8000-000000000102",
              status: "active",
              created_at: "2026-03-01T00:00:00.000Z",
              agent_id: "00000000-0000-4000-8000-000000000002",
              tool_id: "sandbox.current",
              pattern: "sandbox:*",
            },
            {
              policy_override_id: "00000000-0000-4000-8000-000000000103",
              status: "active",
              created_at: "2026-03-01T00:00:00.000Z",
              agent_id: "00000000-0000-4000-8000-000000000002",
              tool_id: "guardian_review_decision",
              pattern: "guardian:*",
            },
            {
              policy_override_id: "00000000-0000-4000-8000-000000000104",
              status: "active",
              created_at: "2026-03-01T00:00:00.000Z",
              agent_id: "00000000-0000-4000-8000-000000000002",
              tool_id: "connector.send",
              pattern: "telegram:work:123",
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

    const readSummary = await waitForTestId<HTMLElement>(
      page.container,
      "policy-override-tool-summary-00000000-0000-4000-8000-000000000101",
    );
    expect(readSummary.textContent).toContain("read");
    expect(readSummary.textContent).toContain("tool.fs.read");
    expect(readSummary.textContent).toContain("public");

    const internalSummary = getByTestId<HTMLElement>(
      page.container,
      "policy-override-tool-summary-00000000-0000-4000-8000-000000000102",
    );
    expect(internalSummary.textContent).toContain("sandbox.current");
    expect(internalSummary.textContent).toContain("internal");

    setSelectValue(
      getByTestId<HTMLSelectElement>(page.container, "admin-policy-override-tool-filter"),
      "guardian_review_decision",
    );
    await flush();

    const filterSummary = await waitForTestId<HTMLElement>(
      page.container,
      "admin-policy-override-tool-filter-metadata",
    );
    expect(filterSummary.textContent).toContain("guardian_review_decision");
    expect(filterSummary.textContent).toContain("runtime_only");
    expect(page.container.textContent).toContain("1 shown");

    setSelectValue(
      getByTestId<HTMLSelectElement>(page.container, "admin-policy-override-tool-filter"),
      "all",
    );
    await flush();

    click(
      getByTestId<HTMLButtonElement>(
        page.container,
        "policy-override-revoke-00000000-0000-4000-8000-000000000104",
      ),
    );

    const revokeSummary = await waitForTestId<HTMLElement>(
      document.body,
      "policy-override-revoke-tool-summary",
    );
    expect(revokeSummary.textContent).toContain("connector.send");
    expect(revokeSummary.textContent).toContain("deprecated");
    expect(revokeSummary.textContent).toContain("public");

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
          tool_id: "tool.fs.read",
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
            tool_id: "tool.fs.read",
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

    await act(async () => {
      setSelectValue(
        getByTestId<HTMLSelectElement>(page.container, "admin-policy-override-agent"),
        "00000000-0000-4000-8000-000000000002",
      );
      setSelectValue(
        getByTestId<HTMLSelectElement>(page.container, "admin-policy-override-tool"),
        "__custom__",
      );
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "admin-policy-override-tool-custom"),
        "tool.fs.read",
      );
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "admin-policy-override-pattern"),
        "docs/*",
      );
      await Promise.resolve();
    });
    await flush();

    const pickerSummary = getByTestId<HTMLElement>(
      page.container,
      "admin-policy-override-tool-metadata",
    );
    expect(pickerSummary.textContent).toContain("read");
    expect(pickerSummary.textContent).toContain("tool.fs.read");
    expect(pickerSummary.textContent).toContain("public");

    const createButton = getByTestId<HTMLButtonElement>(
      page.container,
      "admin-policy-override-create",
    );
    expect(createButton.disabled).toBe(false);
    await clickAndFlush(createButton);

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

    const createSummary = getByTestId<HTMLElement>(
      document.body,
      "policy-override-create-tool-summary",
    );
    expect(createSummary.textContent).toContain("read");
    expect(createSummary.textContent).toContain("tool.fs.read");
    expect(createSummary.textContent).toContain("public");

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
