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
          device_id: "tyrum",
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

function renderAuthTokensCard(core: OperatorCore) {
  return renderIntoDocument(
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
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function findField<T extends HTMLElement>(dialog: HTMLElement | null, labelText: string): T | null {
  const label = Array.from(dialog?.querySelectorAll<HTMLLabelElement>("label") ?? []).find(
    (entry) => entry.textContent?.includes(labelText),
  );
  return label ? ((document.getElementById(label.htmlFor) as T | null) ?? null) : null;
}

async function openEditDialog(container: HTMLElement, tokenId: string): Promise<HTMLElement> {
  const editButton = container.querySelector<HTMLButtonElement>(
    `[data-testid='admin-http-token-edit-${tokenId}']`,
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
  return dialog!;
}

async function clickSave(): Promise<void> {
  const saveButton = document.body.querySelector<HTMLButtonElement>(
    "[data-testid='admin-http-token-dialog-save']",
  );
  expect(saveButton).not.toBeNull();

  await act(async () => {
    saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function setName(dialog: HTMLElement, value: string): Promise<void> {
  const nameInput = findField<HTMLInputElement>(dialog, "Name");
  expect(nameInput).not.toBeNull();

  await act(async () => {
    setNativeValue(nameInput!, value);
    await Promise.resolve();
  });
}

async function setExpirationPreset(dialog: HTMLElement, value: string): Promise<void> {
  const expirationSelect = findField<HTMLSelectElement>(dialog, "Expiration");
  expect(expirationSelect).not.toBeNull();

  await act(async () => {
    expirationSelect!.value = value;
    expirationSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

function findPatchPayload(
  fetchMock: ReturnType<typeof vi.fn>,
  tokenId: string,
): Record<string, unknown> | undefined {
  const patchCall = fetchMock.mock.calls.find(
    ([input, init]) =>
      requestUrl(input) === `http://example.test/auth/tokens/${tokenId}` &&
      init?.method === "PATCH",
  );
  if (!patchCall) return undefined;
  return JSON.parse(String(patchCall[1]?.body)) as Record<string, unknown>;
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
            device_id: "tyrum",
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
    const testRoot = renderAuthTokensCard(core);

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
        device_id: "tyrum",
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

    const testRoot = renderAuthTokensCard(core);

    try {
      await flushAsyncWork();
      const dialog = await openEditDialog(testRoot.container, "expired-token");
      await setName(dialog, "Expired token renamed");
      await clickSave();

      await flushAsyncWork();

      expect(findPatchPayload(fetchMock, "expired-token")).toMatchObject({
        display_name: "Expired token renamed",
      });
      expect(document.body.querySelector("[data-testid='admin-http-token-dialog']")).toBeNull();
      expect(testRoot.container.textContent).toContain("Expired token renamed");
    } finally {
      cleanupTestRoot(testRoot);
      vi.useRealTimers();
    }
  });

  it("preserves preset-matched expiration timestamps on metadata-only edits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));

    const core = createCore();
    const tokens = [
      {
        token_id: "preset-token",
        tenant_id: "11111111-1111-4111-8111-111111111111",
        display_name: "Preset token",
        role: "client" as const,
        device_id: "tyrum",
        scopes: ["operator.read"],
        issued_at: "2026-02-01T00:00:00.000Z",
        expires_at: "2026-03-02T00:00:30.000Z",
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
      if (url === "http://example.test/auth/tokens/preset-token" && init?.method === "PATCH") {
        return new Response(JSON.stringify({ token: tokens[0] }), { status: 200 });
      }
      throw new Error(`Unexpected fetch request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const testRoot = renderAuthTokensCard(core);

    try {
      await flushAsyncWork();
      const dialog = await openEditDialog(testRoot.container, "preset-token");
      await setName(dialog, "Preset token renamed");
      await clickSave();

      await flushAsyncWork();

      expect(findPatchPayload(fetchMock, "preset-token")).toEqual({
        display_name: "Preset token renamed",
        role: "client",
        device_id: "tyrum",
        scopes: ["operator.read"],
      });
    } finally {
      cleanupTestRoot(testRoot);
      vi.useRealTimers();
    }
  });

  it("preserves custom expiration seconds on metadata-only edits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));

    const core = createCore();
    const tokens = [
      {
        token_id: "custom-token",
        tenant_id: "11111111-1111-4111-8111-111111111111",
        display_name: "Custom token",
        role: "client" as const,
        device_id: "tyrum",
        scopes: ["operator.read"],
        issued_at: "2026-02-01T00:00:00.000Z",
        expires_at: "2026-03-05T12:34:56.000Z",
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
      if (url === "http://example.test/auth/tokens/custom-token" && init?.method === "PATCH") {
        return new Response(JSON.stringify({ token: tokens[0] }), { status: 200 });
      }
      throw new Error(`Unexpected fetch request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const testRoot = renderAuthTokensCard(core);

    try {
      await flushAsyncWork();
      const dialog = await openEditDialog(testRoot.container, "custom-token");
      await setName(dialog, "Custom token renamed");
      await clickSave();

      await flushAsyncWork();

      expect(findPatchPayload(fetchMock, "custom-token")).toEqual({
        display_name: "Custom token renamed",
        role: "client",
        device_id: "tyrum",
        scopes: ["operator.read"],
      });
    } finally {
      cleanupTestRoot(testRoot);
      vi.useRealTimers();
    }
  });

  it("clears the expiration when editing a token to never expire", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));

    const core = createCore();
    const tokens = [
      {
        token_id: "never-token",
        tenant_id: "11111111-1111-4111-8111-111111111111",
        display_name: "Timed token",
        role: "client" as const,
        device_id: "tyrum",
        scopes: ["operator.read"],
        issued_at: "2026-02-01T00:00:00.000Z",
        expires_at: "2026-03-02T00:00:30.000Z",
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
      if (url === "http://example.test/auth/tokens/never-token" && init?.method === "PATCH") {
        return new Response(JSON.stringify({ token: { ...tokens[0], expires_at: null } }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const testRoot = renderAuthTokensCard(core);

    try {
      await flushAsyncWork();
      const dialog = await openEditDialog(testRoot.container, "never-token");
      await setExpirationPreset(dialog, "never");
      await clickSave();

      await flushAsyncWork();

      expect(findPatchPayload(fetchMock, "never-token")).toEqual({
        display_name: "Timed token",
        role: "client",
        device_id: "tyrum",
        scopes: ["operator.read"],
        expires_at: null,
      });
    } finally {
      cleanupTestRoot(testRoot);
      vi.useRealTimers();
    }
  });
});
