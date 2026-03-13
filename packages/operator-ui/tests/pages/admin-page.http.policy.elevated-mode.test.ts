// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setNativeValue } from "../test-utils.js";
import {
  cleanupAdminHttpPage,
  click,
  createAdminHttpTestCore,
  flush,
  getByTestId,
  renderAdminHttpConfigurePage,
  setSelectValue,
  switchHttpTab,
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

describe("ConfigurePage (HTTP) policy admin-access transitions", () => {
  it("shows a local admin-access gate if policy access expires before save confirmation", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const writableConfigResponse = policyPageWritableConfigGetResponse(input, init);
      if (writableConfigResponse) return writableConfigResponse;
      const getResponse = policyPageGetResponse(input, init);
      if (getResponse) return getResponse;
      throw new Error(`Unexpected mutation request to ${requestUrl(input)}`);
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
    await act(async () => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "policy-config-save-reason"),
        "Still pending approval",
      );
      await Promise.resolve();
    });
    click(getByTestId<HTMLButtonElement>(page.container, "policy-config-save"));

    act(() => {
      core.elevatedModeStore.exit();
    });
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
    ).toHaveLength(0);
    expect(page.container.querySelector("[data-testid='admin-access-gate']")).not.toBeNull();
    expect(page.container.querySelector("[data-testid='policy-config-save']")).toBeNull();

    cleanupAdminHttpPage(page);
  });

  it("shows a local admin-access gate if override creation access expires", async () => {
    const { core, policyCreateOverride } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const getResponse = policyPageGetResponse(input, init);
      if (getResponse) return getResponse;
      throw new Error(`Unexpected mutation request to ${requestUrl(input)}`);
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

    act(() => {
      core.elevatedModeStore.exit();
    });
    await flush();

    await flush();

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
    expect(page.container.querySelector("[data-testid='admin-access-gate']")).not.toBeNull();
    expect(page.container.querySelector("[data-testid='admin-policy-override-create']")).toBeNull();

    cleanupAdminHttpPage(page);
  });

  it("shows a local admin-access gate when policy revert is opened without admin access", async () => {
    const { core } = createAdminHttpTestCore();
    core.elevatedModeStore.exit();
    core.http.policyConfig!.getDeployment = vi.fn(
      async () =>
        ({
          revision: 2,
          agent_key: null,
          bundle: {
            v: 1,
            tools: { default: "require_approval", allow: ["read"], require_approval: [], deny: [] },
          },
          created_at: "2026-03-02T00:00:00.000Z",
          created_by: { kind: "tenant.token", token_id: "token-2" },
          reason: "Current revision",
          reverted_from_revision: null,
        }) as unknown,
    );
    core.http.policyConfig!.listDeploymentRevisions = vi.fn(
      async () =>
        ({
          revisions: [
            {
              revision: 1,
              agent_key: null,
              created_at: "2026-03-01T00:00:00.000Z",
              created_by: { kind: "tenant.token", token_id: "token-1" },
              reason: "Initial revision",
              reverted_from_revision: null,
            },
          ],
        }) as unknown,
    );

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-policy");
    await flush();
    await flush();

    expect(core.http.policyConfig!.revertDeployment).toHaveBeenCalledTimes(0);
    expect(page.container.querySelector("[data-testid='admin-access-gate']")).not.toBeNull();
    expect(page.container.querySelector("[data-testid='policy-config-revert-1']")).toBeNull();

    cleanupAdminHttpPage(page);
  });

  it("shows a local admin-access gate when override revocation is opened without admin access", async () => {
    const { core } = createAdminHttpTestCore();
    core.elevatedModeStore.exit();
    core.http.policy.listOverrides = vi.fn(
      async () =>
        ({
          status: "ok",
          overrides: [
            {
              policy_override_id: "00000000-0000-0000-0000-000000000001",
              status: "active",
              created_at: "2026-03-01T00:00:00.000Z",
              agent_id: "00000000-0000-4000-8000-000000000002",
              tool_id: "read",
              pattern: "docs/*",
            },
          ],
        }) as unknown,
    );

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-policy");
    await flush();
    await flush();

    expect(core.http.policy.revokeOverride).toHaveBeenCalledTimes(0);
    expect(page.container.querySelector("[data-testid='admin-access-gate']")).not.toBeNull();
    expect(
      page.container.querySelector(
        "[data-testid='policy-override-revoke-00000000-0000-0000-0000-000000000001']",
      ),
    ).toBeNull();

    cleanupAdminHttpPage(page);
  });
});
