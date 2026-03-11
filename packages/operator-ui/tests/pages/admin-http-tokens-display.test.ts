// @vitest-environment jsdom

import { parseMobileBootstrapUrl } from "@tyrum/schemas";
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
});
