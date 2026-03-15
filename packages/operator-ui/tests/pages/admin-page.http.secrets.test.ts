// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubAdminHttpFetch } from "../admin-http-fetch-test-support.js";
import { setNativeValue } from "../test-utils.js";
import {
  cleanupAdminHttpPage,
  click,
  clickAndFlush,
  createAdminHttpTestCore,
  expectAuthorizedJsonRequest,
  flush,
  getByTestId,
  getLabeledInput,
  jsonResponse,
  renderAdminHttpConfigurePage,
  switchHttpTab,
} from "./admin-page.http.test-support.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function createSecretHandle(
  overrides: Partial<{
    handle_id: string;
    provider: "db";
    scope: string;
    created_at: string;
  }> = {},
) {
  return {
    handle_id: "alpha",
    provider: "db" as const,
    scope: "alpha",
    created_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ConfigurePage (HTTP) secrets", () => {
  it("auto-loads structured secrets, hides internal handles, and filters rows", async () => {
    const { core } = createAdminHttpTestCore();
    const listSecrets = vi.fn(async () => ({
      handles: [
        createSecretHandle({
          handle_id: "alpha",
          created_at: "2026-03-01T00:00:00.000Z",
        }),
        createSecretHandle({
          handle_id: "beta",
          scope: "scope:beta",
          created_at: "2026-03-02T00:00:00.000Z",
        }),
        createSecretHandle({
          handle_id: "provider-account:openai:api_key",
          scope: "provider-account:openai:api_key",
          created_at: "2026-03-03T00:00:00.000Z",
        }),
      ],
    }));
    core.http.secrets.list = listSecrets as typeof core.http.secrets.list;
    stubAdminHttpFetch(core);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-secrets");
    await flush();

    expect(listSecrets).toHaveBeenCalledTimes(1);
    expect(page.container.textContent).toContain("alpha");
    expect(page.container.textContent).toContain("beta");
    expect(page.container.textContent).toContain("Scope: scope:beta");
    expect(page.container.textContent).not.toContain("provider-account:openai:api_key");
    expect(page.container.textContent).not.toContain("Agent scope");
    expect(page.container.textContent).not.toContain("Agent key");

    const filterInput = getByTestId<HTMLInputElement>(page.container, "admin-http-secrets-filter");
    act(() => {
      setNativeValue(filterInput, "beta");
    });
    await flush();

    const alphaRow = page.container.querySelector("[data-testid='secret-row-alpha']");
    const betaRow = page.container.querySelector("[data-testid='secret-row-beta']");
    expect(alphaRow?.textContent ?? "").not.toContain("alpha");
    expect(betaRow?.textContent ?? "").toContain("beta");

    cleanupAdminHttpPage(page);
  });

  it("stores a secret from the toolbar dialog after confirmation", async () => {
    const { core } = createAdminHttpTestCore();
    let listRequestCount = 0;
    const listSecrets = vi.fn(async () => {
      listRequestCount += 1;
      return {
        handles:
          listRequestCount === 1
            ? [createSecretHandle({ handle_id: "alpha" })]
            : [
                createSecretHandle({
                  handle_id: "gamma",
                  created_at: "2026-03-02T00:00:00.000Z",
                }),
                createSecretHandle({ handle_id: "alpha" }),
              ],
      };
    });
    core.http.secrets.list = listSecrets as typeof core.http.secrets.list;

    const { writeSpy } = stubAdminHttpFetch(core, async (input: RequestInfo | URL, init) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/secrets",
        method: "POST",
        body: { secret_key: "gamma", value: "new-secret" },
      });
      return jsonResponse(
        {
          handle: createSecretHandle({
            handle_id: "gamma",
            created_at: "2026-03-02T00:00:00.000Z",
          }),
        },
        201,
      );
    });

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-secrets");
    await flush();

    click(getByTestId<HTMLButtonElement>(page.container, "admin-http-secrets-store-open"));

    const confirmButton = getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm");
    expect(confirmButton.disabled).toBe(true);

    act(() => {
      setNativeValue(getLabeledInput(document.body, "Secret key"), "gamma");
      setNativeValue(getLabeledInput(document.body, "Value"), "new-secret");
    });
    await flush();

    expect(confirmButton.disabled).toBe(true);
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    expect(confirmButton.disabled).toBe(false);

    await clickAndFlush(confirmButton);
    await flush();

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(listSecrets).toHaveBeenCalledTimes(2);
    expect(page.container.querySelector("[data-testid='secret-row-gamma']")).not.toBeNull();
    expect(page.container.textContent).toContain('Stored secret "gamma".');

    cleanupAdminHttpPage(page);
  });

  it("preserves whitespace when rotating secrets", async () => {
    const { core, secretsRotate } = createAdminHttpTestCore();
    core.http.secrets.list = vi.fn(async () => ({
      handles: [createSecretHandle({ handle_id: "h-1" })],
    })) as typeof core.http.secrets.list;

    const { writeSpy } = stubAdminHttpFetch(core, async (input: RequestInfo | URL, init) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/secrets/h-1/rotate",
        method: "POST",
        body: { value: "  new-secret  " },
      });
      return jsonResponse(
        {
          revoked: true,
          handle: {
            handle_id: "h-1",
            provider: "db",
            scope: "h-1",
            created_at: "2026-03-01T00:00:00.000Z",
          },
        },
        201,
      );
    });

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-secrets");
    await flush();

    const rotateButton = getByTestId<HTMLButtonElement>(page.container, "secret-rotate-open-h-1");
    click(rotateButton);
    const rotateCard = getByTestId<HTMLDivElement>(document.body, "secrets-rotate-card");
    act(() => {
      setNativeValue(getLabeledInput(rotateCard, "New value"), "  new-secret  ");
    });
    await flush();

    const confirmButton = getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm");
    expect(confirmButton.disabled).toBe(true);
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    expect(confirmButton.disabled).toBe(false);

    await clickAndFlush(confirmButton);

    expect(secretsRotate).toHaveBeenCalledTimes(0);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });

  it("revokes a secret row and refreshes the list", async () => {
    const { core } = createAdminHttpTestCore();
    let listRequestCount = 0;
    const listSecrets = vi.fn(async () => {
      listRequestCount += 1;
      return {
        handles:
          listRequestCount === 1
            ? [
                createSecretHandle({ handle_id: "secret-a" }),
                createSecretHandle({
                  handle_id: "secret-b",
                  created_at: "2026-03-02T00:00:00.000Z",
                }),
              ]
            : [
                createSecretHandle({
                  handle_id: "secret-b",
                  created_at: "2026-03-02T00:00:00.000Z",
                }),
              ],
      };
    });
    core.http.secrets.list = listSecrets as typeof core.http.secrets.list;

    const { writeSpy } = stubAdminHttpFetch(core, async (input: RequestInfo | URL, init) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/secrets/secret-a",
        method: "DELETE",
      });
      return jsonResponse({ revoked: true }, 200);
    });

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-secrets");
    await flush();

    click(getByTestId<HTMLButtonElement>(page.container, "secret-revoke-open-secret-a"));
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));
    await flush();

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(listSecrets).toHaveBeenCalledTimes(2);
    expect(page.container.querySelector("[data-testid='secret-row-secret-a']")).toBeNull();
    expect(page.container.querySelector("[data-testid='secret-row-secret-b']")).not.toBeNull();

    cleanupAdminHttpPage(page);
  });
});
