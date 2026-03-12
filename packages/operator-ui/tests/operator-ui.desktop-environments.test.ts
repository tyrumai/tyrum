// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import { ElevatedModeProvider } from "../src/components/elevated-mode/elevated-mode-provider.js";
import { DesktopEnvironmentsPage } from "../src/components/pages/desktop-environments-page.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("desktop environments page", () => {
  it("lists managed desktop environments and exposes takeover", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(
          ElevatedModeProvider,
          { core, mode: "desktop" },
          React.createElement(DesktopEnvironmentsPage, { core }),
        ),
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="desktop-environments-page"]')).not.toBeNull();
    expect(container.textContent).toContain("Research desktop");

    const takeoverLink = container.querySelector<HTMLAnchorElement>(
      'a[href*="desktop-environments/env-1/takeover"]',
    );
    expect(takeoverLink).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
});
