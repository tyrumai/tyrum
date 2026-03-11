// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createElevatedModeStore } from "../../../operator-core/src/stores/elevated-mode-store.js";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import { AuthTokensCard } from "../../src/components/pages/admin-http-tokens.js";
import { ThemeProvider } from "../../src/hooks/use-theme.js";
import { cleanupTestRoot, renderIntoDocument, setNativeValue } from "../test-utils.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function createCore(): OperatorCore {
  const elevatedModeStore = createElevatedModeStore({
    tickIntervalMs: 0,
    now: () => Date.parse("2026-03-01T00:00:00.000Z"),
  });
  elevatedModeStore.enter({
    elevatedToken: "test-elevated-token",
    expiresAt: "2026-03-01T00:10:00.000Z",
  });

  return {
    elevatedModeStore,
    httpBaseUrl: "http://example.test",
    http: {
      authTokens: {
        list: vi.fn(async () => ({ tokens: [] })),
        issue: vi.fn(async () => ({
          token: "tyrum-token.v1.token-id.secret",
          token_id: "token-1",
          tenant_id: "11111111-1111-4111-8111-111111111111",
          display_name: "Operator token",
          role: "client",
          device_id: "operator-ui",
          scopes: [],
          issued_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z",
        })),
        update: vi.fn(async () => ({ token: {} })),
        revoke: vi.fn(async () => ({ revoked: true, token_id: "token-1" })),
      },
    },
  } as unknown as OperatorCore;
}

async function issueToken(container: HTMLElement, name: string): Promise<void> {
  const issueButton = container.querySelector<HTMLButtonElement>(
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
      setNativeValue(nameInput, name);
    }
    await Promise.resolve();
  });

  const saveButton = document.body.querySelector<HTMLButtonElement>(
    "[data-testid='admin-http-token-dialog-save']",
  );
  expect(saveButton).not.toBeNull();

  await act(async () => {
    saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function flushAsyncWork(turns = 3): Promise<void> {
  await act(async () => {
    for (let index = 0; index < turns; index += 1) {
      await Promise.resolve();
    }
  });
}

describe("AuthTokensCard", () => {
  it("lets users dismiss issued secrets and clears them when a new token action starts", async () => {
    const core = createCore();
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
            token_id: "token-1",
            tenant_id: "11111111-1111-4111-8111-111111111111",
            display_name: "Operator token",
            role: "client",
            device_id: "operator-ui",
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
    const testRoot = renderIntoDocument(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          ElevatedModeProvider,
          { core, mode: "web" },
          React.createElement(AuthTokensCard, { core }),
        ),
      ),
    );

    try {
      await issueToken(testRoot.container, "Dismissible token");
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-token-secret-panel']"),
      ).not.toBeNull();

      const dismissButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-token-secret-dismiss']",
      );
      expect(dismissButton).not.toBeNull();

      await act(async () => {
        dismissButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(
        testRoot.container.querySelector("[data-testid='admin-http-token-secret-panel']"),
      ).toBeNull();

      await issueToken(testRoot.container, "Second token");
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-token-secret-panel']"),
      ).not.toBeNull();

      const addButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-tokens-issue']",
      );
      expect(addButton).not.toBeNull();

      await act(async () => {
        addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(
        testRoot.container.querySelector("[data-testid='admin-http-token-secret-panel']"),
      ).toBeNull();
      expect(document.body.querySelector("[data-testid='admin-http-token-dialog']")).not.toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("allows editing an expired token without changing its expiration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));

    const core = createCore();
    let tokens = [
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
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "http://example.test/auth/tokens" && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ tokens }), { status: 200 });
      }
      if (url === "http://example.test/auth/tokens/expired-token" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { display_name: string };
        tokens = tokens.map((token) =>
          token.token_id === "expired-token"
            ? { ...token, display_name: body.display_name }
            : token,
        );
        return new Response(JSON.stringify({ token: tokens[0] }), { status: 200 });
      }
      throw new Error(`Unexpected fetch request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const testRoot = renderIntoDocument(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          ElevatedModeProvider,
          { core, mode: "web" },
          React.createElement(AuthTokensCard, { core }),
        ),
      ),
    );

    try {
      await flushAsyncWork();
      const editButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-token-edit-expired-token']",
      );
      expect(editButton).not.toBeNull();

      await act(async () => {
        editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
        setNativeValue(nameInput!, "Expired token renamed");
        await Promise.resolve();
      });

      const saveButton = document.body.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-token-dialog-save']",
      );
      expect(saveButton).not.toBeNull();

      await act(async () => {
        saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      await flushAsyncWork();

      const patchCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          (typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url) === "http://example.test/auth/tokens/expired-token" &&
          init?.method === "PATCH",
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
        display_name: "Expired token renamed",
      });
      expect(document.body.querySelector("[data-testid='admin-http-token-dialog']")).toBeNull();
      expect(testRoot.container.textContent).toContain("Expired token renamed");
    } finally {
      cleanupTestRoot(testRoot);
      vi.useRealTimers();
    }
  });
});
