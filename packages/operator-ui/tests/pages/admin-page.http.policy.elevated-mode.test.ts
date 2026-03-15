// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TyrumHttpClientError } from "@tyrum/client/browser";
import { setNativeValue } from "../test-utils.js";
import {
  cleanupAdminHttpPage,
  click,
  clickAndFlush,
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

async function waitForAssertion(assertion: () => void, attempts = 8): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flush();
    }
  }
  throw lastError;
}

describe("ConfigurePage (HTTP) policy elevated mode prompts", () => {
  it("falls back to the admin access gate when policy reads lose admin scope", async () => {
    const { core } = createAdminHttpTestCore();
    const forbiddenError = new TyrumHttpClientError("http_error", "insufficient scope", {
      status: 403,
      error: "forbidden",
    });
    core.http.policy.getBundle = vi.fn(async () => {
      throw forbiddenError;
    });
    core.http.policy.listOverrides = vi.fn(async () => {
      throw forbiddenError;
    });
    core.http.policyConfig!.getDeployment = vi.fn(async () => {
      throw forbiddenError;
    });
    core.http.policyConfig!.listDeploymentRevisions = vi.fn(async () => {
      throw forbiddenError;
    });
    core.http.agents!.list = vi.fn(async () => {
      throw forbiddenError;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "forbidden", message: "insufficient scope" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-policy");
    await flush();
    await flush();

    expect(document.body.querySelector("[data-testid='admin-access-gate']")).not.toBeNull();
    expect(document.body.textContent).toContain(
      "Authorize admin access to load policy configuration",
    );
    expect(document.body.textContent).not.toContain("insufficient scope");
    expect(page.container.querySelector("[data-testid='admin-http-policy']")).toBeNull();

    cleanupAdminHttpPage(page);
  });

  it("reloads policy reads only once when elevated mode is re-entered", async () => {
    let allowReads = false;
    const { core } = createAdminHttpTestCore();
    const forbiddenError = new TyrumHttpClientError("http_error", "insufficient scope", {
      status: 403,
      error: "forbidden",
    });
    core.http.policy.getBundle = vi.fn(async () => {
      throw forbiddenError;
    });
    core.http.policy.listOverrides = vi.fn(async () => {
      throw forbiddenError;
    });
    core.http.policyConfig!.getDeployment = vi.fn(async () => {
      throw forbiddenError;
    });
    core.http.policyConfig!.listDeploymentRevisions = vi.fn(async () => {
      throw forbiddenError;
    });
    core.http.agents!.list = vi.fn(async () => {
      throw forbiddenError;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const writableConfigResponse = policyPageWritableConfigGetResponse(input, init);
      const getResponse = policyPageGetResponse(input, init);
      const readResponse = writableConfigResponse ?? getResponse;
      if (readResponse) {
        if (!allowReads) {
          return new Response(
            JSON.stringify({ error: "forbidden", message: "insufficient scope" }),
            {
              status: 403,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return readResponse;
      }
      throw new Error(`Unexpected mutation request to ${requestUrl(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-policy");
    await waitForAssertion(() => {
      expect(document.body.querySelector("[data-testid='admin-access-gate']")).not.toBeNull();
    });

    allowReads = true;
    act(() => {
      core.elevatedModeStore.enter({
        elevatedToken: "test-elevated-token",
        expiresAt: "2026-03-01T00:02:00.000Z",
      });
    });

    await waitForAssertion(() => {
      expect(page.container.querySelector("[data-testid='admin-http-policy']")).not.toBeNull();
    });

    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          requestUrl(input as RequestInfo | URL) === "http://example.test/policy/bundle" &&
          (init?.method ?? "GET") === "GET",
      ),
    ).toHaveLength(2);

    cleanupAdminHttpPage(page);
  });

  it("re-prompts for Elevated Mode if policy save is confirmed after elevated access expires", async () => {
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

    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));
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
    expect(getByTestId(document.body, "elevated-mode-dialog")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Policy save failed");
    expect(document.body.textContent).not.toContain("Action failed");
    expect(page.container.querySelector("[data-elevated-mode-guard]")).not.toBeNull();

    cleanupAdminHttpPage(page);
  });

  it("re-prompts for Elevated Mode if override creation is confirmed after elevated access expires", async () => {
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

    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));
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
    expect(getByTestId(document.body, "elevated-mode-dialog")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Override creation failed");
    expect(document.body.textContent).not.toContain("Action failed");
    expect(
      getByTestId<HTMLSelectElement>(page.container, "admin-policy-override-agent").value,
    ).toBe("00000000-0000-4000-8000-000000000002");
    expect(getByTestId<HTMLSelectElement>(page.container, "admin-policy-override-tool").value).toBe(
      "read",
    );
    expect(
      getByTestId<HTMLInputElement>(page.container, "admin-policy-override-pattern").value,
    ).toBe("docs/*");

    cleanupAdminHttpPage(page);
  });

  it("re-prompts for Elevated Mode if policy revert is confirmed while access is inactive", async () => {
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

    click(getByTestId<HTMLButtonElement>(page.container, "policy-config-revert-1"));
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));
    await flush();

    expect(core.http.policyConfig!.revertDeployment).toHaveBeenCalledTimes(0);
    expect(getByTestId(document.body, "elevated-mode-dialog")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Policy revert failed");
    expect(document.body.textContent).not.toContain("Action failed");

    cleanupAdminHttpPage(page);
  });

  it("re-prompts for Elevated Mode if override revocation is confirmed while access is inactive", async () => {
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

    click(
      getByTestId<HTMLButtonElement>(
        page.container,
        "policy-override-revoke-00000000-0000-0000-0000-000000000001",
      ),
    );
    await act(async () => {
      setNativeValue(
        getByTestId<HTMLTextAreaElement>(document.body, "policy-override-revoke-reason"),
        "No longer needed",
      );
      await Promise.resolve();
    });

    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));
    await flush();

    expect(core.http.policy.revokeOverride).toHaveBeenCalledTimes(0);
    expect(getByTestId(document.body, "elevated-mode-dialog")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Override revocation failed");
    expect(document.body.textContent).not.toContain("Action failed");

    cleanupAdminHttpPage(page);
  });
});
