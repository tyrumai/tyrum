// @vitest-environment jsdom

import { parseMobileBootstrapUrl } from "@tyrum/contracts";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssuedTokenNotice } from "../../src/components/pages/admin-http-tokens-display.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const { qrcodeToStringMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  qrcodeToStringMock: vi.fn(async () => '<svg data-testid="mobile-bootstrap-qr"></svg>'),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("qrcode", () => ({
  default: {
    toString: qrcodeToStringMock,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function flushMicrotasks(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("IssuedTokenNotice", () => {
  it("copies a mobile bootstrap link and renders a QR dialog for the issued token", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const testRoot = renderIntoDocument(
      React.createElement(IssuedTokenNotice, {
        token: {
          token: "tyrum-token.v1.secret",
          token_id: "token-1",
          tenant_id: "11111111-1111-4111-8111-111111111111",
          display_name: "Mobile bootstrap token",
          role: "client",
          device_id: "phone-1",
          scopes: [],
          issued_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z",
        },
        gatewayHttpBaseUrl: "https://gateway.example/",
        onDismiss: vi.fn(),
      }),
    );

    try {
      const copyLinkButton = testRoot.container.querySelector<HTMLButtonElement>(
        '[data-testid="admin-http-token-mobile-link-copy"]',
      );
      const qrButton = testRoot.container.querySelector<HTMLButtonElement>(
        '[data-testid="admin-http-token-mobile-qr"]',
      );
      expect(copyLinkButton).not.toBeNull();
      expect(qrButton).not.toBeNull();

      await act(async () => {
        copyLinkButton?.click();
        await flushMicrotasks();
      });

      const copiedUrl = writeText.mock.calls[0]?.[0] as string | undefined;
      expect(copiedUrl).toMatch(/^tyrum:\/\/bootstrap\?payload=/);
      expect(parseMobileBootstrapUrl(copiedUrl ?? "")).toMatchObject({
        httpBaseUrl: "https://gateway.example",
        wsUrl: "wss://gateway.example/ws",
        token: "tyrum-token.v1.secret",
      });
      expect(toastSuccessMock).toHaveBeenCalledWith("Copied mobile link");

      await act(async () => {
        qrButton?.click();
        await flushMicrotasks();
      });

      expect(document.body.textContent).toContain("Mobile bootstrap QR");
      expect(document.body.querySelector('[data-testid="mobile-bootstrap-qr"]')).not.toBeNull();
      expect(qrcodeToStringMock).toHaveBeenCalledWith(
        copiedUrl,
        expect.objectContaining({
          type: "svg",
          width: 256,
        }),
      );
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("clears stale QR markup while regenerating after bootstrap data changes", async () => {
    const firstQr = createDeferred<string>();
    const secondQr = createDeferred<string>();
    qrcodeToStringMock
      .mockImplementationOnce(() => firstQr.promise)
      .mockImplementationOnce(() => secondQr.promise);

    const testRoot = renderIntoDocument(
      React.createElement(IssuedTokenNotice, {
        token: {
          token: "tyrum-token.v1.first",
          token_id: "token-1",
          tenant_id: "11111111-1111-4111-8111-111111111111",
          display_name: "Mobile bootstrap token",
          role: "client",
          device_id: "phone-1",
          scopes: [],
          issued_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z",
        },
        gatewayHttpBaseUrl: "https://gateway.example/",
        onDismiss: vi.fn(),
      }),
    );

    try {
      const qrButton = testRoot.container.querySelector<HTMLButtonElement>(
        '[data-testid="admin-http-token-mobile-qr"]',
      );
      expect(qrButton).not.toBeNull();

      await act(async () => {
        qrButton?.click();
        await flushMicrotasks();
      });

      expect(document.body.textContent).toContain("Generating QR…");

      await act(async () => {
        firstQr.resolve('<svg data-testid="mobile-bootstrap-qr-first"></svg>');
        await flushMicrotasks();
      });

      expect(
        document.body.querySelector('[data-testid="mobile-bootstrap-qr-first"]'),
      ).not.toBeNull();

      await act(async () => {
        testRoot.root.render(
          React.createElement(IssuedTokenNotice, {
            token: {
              token: "tyrum-token.v1.second",
              token_id: "token-2",
              tenant_id: "11111111-1111-4111-8111-111111111111",
              display_name: "Mobile bootstrap token",
              role: "client",
              device_id: "phone-2",
              scopes: [],
              issued_at: "2026-03-02T00:00:00.000Z",
              updated_at: "2026-03-02T00:00:00.000Z",
            },
            gatewayHttpBaseUrl: "https://gateway.example/",
            onDismiss: vi.fn(),
          }),
        );
        await flushMicrotasks();
      });

      expect(document.body.textContent).toContain("Generating QR…");
      expect(document.body.querySelector('[data-testid="mobile-bootstrap-qr-first"]')).toBeNull();

      await act(async () => {
        secondQr.resolve('<svg data-testid="mobile-bootstrap-qr-second"></svg>');
        await flushMicrotasks();
      });

      expect(
        document.body.querySelector('[data-testid="mobile-bootstrap-qr-second"]'),
      ).not.toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("keeps rendering when the gateway base URL cannot produce a bootstrap link", () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const testRoot = renderIntoDocument(
      React.createElement(IssuedTokenNotice, {
        token: {
          token: "tyrum-token.v1.secret",
          token_id: "token-1",
          tenant_id: "11111111-1111-4111-8111-111111111111",
          display_name: "Mobile bootstrap token",
          role: "client",
          device_id: "phone-1",
          scopes: [],
          issued_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z",
        },
        gatewayHttpBaseUrl: "gateway.example",
        onDismiss: vi.fn(),
      }),
    );

    try {
      const qrButton = testRoot.container.querySelector<HTMLButtonElement>(
        '[data-testid="admin-http-token-mobile-qr"]',
      );
      const copyLinkButton = testRoot.container.querySelector<HTMLButtonElement>(
        '[data-testid="admin-http-token-mobile-link-copy"]',
      );

      expect(testRoot.container.textContent).toContain("Mobile bootstrap unavailable");
      expect(testRoot.container.textContent).toContain("Expected an http:// or https:// URL.");
      expect(qrButton?.disabled).toBe(true);
      expect(copyLinkButton?.disabled).toBe(true);
      expect(writeText).not.toHaveBeenCalled();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
