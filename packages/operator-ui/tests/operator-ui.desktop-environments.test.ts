// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-app/src/index.js";
import { ElevatedModeProvider } from "../src/components/elevated-mode/elevated-mode-provider.js";
import { DesktopEnvironmentsPage } from "../src/components/pages/desktop-environments-page.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("desktop environments page", () => {
  it("shows an admin access prompt before loading desktop environments", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });
    const hostListCallsBeforeRender = http.desktopEnvironmentHosts.list.mock.calls.length;
    const environmentListCallsBeforeRender = http.desktopEnvironments.list.mock.calls.length;

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
    expect(container.textContent).toContain("Authorize admin access to load desktop environments");
    expect(http.desktopEnvironmentHosts.list.mock.calls.length).toBeGreaterThanOrEqual(
      hostListCallsBeforeRender,
    );
    expect(http.desktopEnvironments.list.mock.calls.length).toBeGreaterThanOrEqual(
      environmentListCallsBeforeRender,
    );

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
});
