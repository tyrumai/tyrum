// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setNativeValue, cleanupTestRoot } from "../test-utils.js";
import { cleanupTestRoot } from "../test-utils.js";
import {
  createPanelsCore,
  renderStrictAdminConfigurePage,
  switchAdminTab,
} from "./admin-page.http-panels.test-support.js";
import { setNativeValue } from "../test-utils.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("ConfigurePage (strict admin tabs)", () => {
  it("renders admin domain tabs and removes transport tabs", () => {
    const { core } = createPanelsCore(false);
    const testRoot = renderStrictAdminConfigurePage(core);

    try {
      expect(testRoot.container.querySelector("[data-testid='admin-tab-http']")).toBeNull();
      expect(testRoot.container.querySelector("[data-testid='admin-tab-ws']")).toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='configure-tab-general']"),
      ).not.toBeNull();

      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-policy']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-providers']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-models']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-audit']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-routing-config']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-secrets']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-gateway']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-ws-tab-commands']"),
      ).not.toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("keeps admin mutations disabled outside Elevated Mode", async () => {
    const { core } = createPanelsCore(false);
    const testRoot = renderStrictAdminConfigurePage(core);

    try {
      await switchAdminTab(testRoot.container, "admin-http-tab-gateway");
      const issueButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-tokens-issue']",
      );
      expect(issueButton).not.toBeNull();
      expect(issueButton?.closest("[data-elevated-mode-guard]")).not.toBeNull();

      await switchAdminTab(testRoot.container, "admin-http-tab-providers");
      const addProviderButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='providers-add-open']",
      );
      expect(addProviderButton).not.toBeNull();
      expect(addProviderButton?.closest("[data-elevated-mode-guard]")).not.toBeNull();

      await switchAdminTab(testRoot.container, "admin-http-tab-models");
      const addModelButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='models-add-open']",
      );
      expect(addModelButton).not.toBeNull();
      expect(addModelButton?.closest("[data-elevated-mode-guard]")).not.toBeNull();

      await switchAdminTab(testRoot.container, "admin-http-tab-policy");
      const createOverrideButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-policy-override-create']",
      );
      expect(createOverrideButton).not.toBeNull();
      expect(createOverrideButton?.closest("[data-elevated-mode-guard]")).not.toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("enables admin mutations when Elevated Mode is active", async () => {
    const { core } = createPanelsCore(true);
    const testRoot = renderStrictAdminConfigurePage(core);

    try {
      await switchAdminTab(testRoot.container, "admin-http-tab-gateway");
      const issueButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-tokens-issue']",
      );
      expect(issueButton).not.toBeNull();
      expect(issueButton?.disabled).toBe(false);

      await switchAdminTab(testRoot.container, "admin-http-tab-providers");
      const addProviderButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='providers-add-open']",
      );
      expect(addProviderButton).not.toBeNull();
      expect(addProviderButton?.disabled).toBe(false);

      await switchAdminTab(testRoot.container, "admin-http-tab-models");
      const addModelButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='models-add-open']",
      );
      expect(addModelButton).not.toBeNull();
      expect(addModelButton?.disabled).toBe(false);
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("uses the elevated admin token for tenant token issuance", async () => {
    const { core } = createPanelsCore(true);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "http://example.test/auth/tokens" && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ tokens: [] }), { status: 200 });
      }
      if (url === "http://example.test/auth/tokens/issue" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            token: "tyrum-token.v1.token-id.secret",
            token_id: "dev_test_id",
            tenant_id: "11111111-1111-4111-8111-111111111111",
            display_name: "Operator token",
            device_id: "operator-ui",
            role: "client",
            scopes: [],
            issued_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
          }),
          { status: 201 },
        );
      }
      throw new Error(`Unexpected fetch request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const testRoot = renderStrictAdminConfigurePage(core);

    try {
      await switchAdminTab(testRoot.container, "admin-http-tab-gateway");

      const issueButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-tokens-issue']",
      );
      expect(issueButton).not.toBeNull();

      await act(async () => {
        issueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      const dialog = document.body.querySelector<HTMLElement>(
        "[data-testid='admin-http-token-dialog']",
      );
      expect(dialog).not.toBeNull();

      const nameLabel = Array.from(dialog?.querySelectorAll<HTMLLabelElement>("label") ?? []).find(
        (label) => label.textContent?.includes("Name"),
      );
      const nameInput = nameLabel
        ? (document.getElementById(nameLabel.htmlFor) as HTMLInputElement | null)
        : null;
      expect(nameInput).not.toBeNull();

      await act(async () => {
        if (nameInput) {
          setNativeValue(nameInput, "Operator token");
        }
        await Promise.resolve();
      });

      const confirmButton = document.body.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-token-dialog-save']",
      );
      expect(confirmButton).not.toBeNull();

      await act(async () => {
        confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      const issueCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(issueCall).toBeDefined();
      const [input, init] = issueCall ?? [];
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";

      expect(url).toBe("http://example.test/auth/tokens/issue");
      expect(init?.method).toBe("POST");

      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-elevated-token");

      const bodyRaw = String(init?.body ?? "");
      expect(JSON.parse(bodyRaw)).toEqual({
        display_name: "Operator token",
        role: "client",
        scopes: ["operator.read"],
        device_id: "operator-ui",
        ttl_seconds: 86400,
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("shows expired tenant tokens as expired and keeps revoke available", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));

    const { core } = createPanelsCore(true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "http://example.test/auth/tokens" && (!init?.method || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            tokens: [
              {
                token_id: "expired-token",
                tenant_id: "11111111-1111-4111-8111-111111111111",
                display_name: "Expired token",
                role: "client",
                device_id: "operator-ui",
                scopes: ["operator.read"],
                issued_at: "2026-02-01T00:00:00.000Z",
                expires_at: "2026-02-28T23:59:59.000Z",
                revoked_at: null,
                created_at: "2026-02-01T00:00:00.000Z",
                updated_at: "2026-02-01T00:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const testRoot = renderStrictAdminConfigurePage(core);

    try {
      await switchAdminTab(testRoot.container, "admin-http-tab-gateway");
      expect(testRoot.container.textContent).toContain("Expired");

      const revokeButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-token-revoke-expired-token']",
      );
      expect(revokeButton).not.toBeNull();
      expect(revokeButton?.disabled).toBe(false);
    } finally {
      cleanupTestRoot(testRoot);
      vi.useRealTimers();
    }
  });
});
