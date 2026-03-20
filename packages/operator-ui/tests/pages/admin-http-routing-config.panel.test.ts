// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import { AdminHttpRoutingConfigPanel } from "../../src/components/pages/admin-http-routing-config.js";
import { stubAdminHttpFetch } from "../admin-http-fetch-test-support.js";
import {
  clickAndFlush,
  createAdminHttpTestCore,
  flush,
  getByTestId,
  waitForEnabledTestId,
  waitForQuerySelector,
  waitForTestId,
} from "./admin-page.http.test-support.js";
import {
  cleanupTestRoot,
  renderIntoDocument,
  setNativeValue,
  type TestRoot,
} from "../test-utils.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderRoutingConfigPanel(
  configureCore?: (core: ReturnType<typeof createAdminHttpTestCore>["core"]) => void,
): {
  core: ReturnType<typeof createAdminHttpTestCore>["core"];
  routingConfigUpdate: ReturnType<typeof createAdminHttpTestCore>["routingConfigUpdate"];
  routingConfigRevert: ReturnType<typeof createAdminHttpTestCore>["routingConfigRevert"];
  testRoot: TestRoot;
} {
  const { core, routingConfigUpdate, routingConfigRevert } = createAdminHttpTestCore();
  configureCore?.(core);
  stubAdminHttpFetch(core);
  const testRoot = renderIntoDocument(
    React.createElement(
      ElevatedModeProvider,
      { core, mode: "web" },
      React.createElement(AdminHttpRoutingConfigPanel, { core }),
    ),
  );
  return { core, routingConfigUpdate, routingConfigRevert, testRoot };
}

async function waitForText(root: ParentNode, text: string, attempts = 50): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (root.textContent?.includes(text)) {
      return;
    }
    await flush();
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

describe("AdminHttpRoutingConfigPanel", () => {
  it("shows loading states before the panel data resolves", () => {
    const { testRoot } = renderRoutingConfigPanel();

    try {
      expect(testRoot.container.textContent).toContain("Loading channels routing…");
      expect(testRoot.container.textContent).toContain("Loading routing history…");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("filters routing rules and shows the no-match alert", async () => {
    const { testRoot } = renderRoutingConfigPanel();

    try {
      await waitForTestId(testRoot.container, "admin-http-routing-config");
      await waitForTestId(testRoot.container, "routing-rule-row-telegram:thread:default:tg-123");

      expect(testRoot.container.textContent).toContain("Support room");
      expect(testRoot.container.textContent).toContain("All unmatched Telegram chats on default");

      setNativeValue(
        getByTestId<HTMLInputElement>(testRoot.container, "channels-filter"),
        "nomatch",
      );
      await flush();

      expect(testRoot.container.textContent).toContain("No routing rules match the current filter");
      expect(
        testRoot.container.querySelector(
          "[data-testid='routing-rule-row-telegram:thread:default:tg-123']",
        ),
      ).toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("opens the routing rule dialog from the add button", async () => {
    const { testRoot } = renderRoutingConfigPanel();

    try {
      await waitForEnabledTestId<HTMLButtonElement>(testRoot.container, "channels-add-open");
      await clickAndFlush(getByTestId<HTMLButtonElement>(testRoot.container, "channels-add-open"));

      const dialog = await waitForTestId<HTMLElement>(document.body, "channels-rule-dialog");
      expect(dialog.textContent).toContain("Add routing rule");
      expect(dialog.textContent).toContain("Rule type");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("opens the remove-rule confirmation dialog from a row action", async () => {
    const { testRoot } = renderRoutingConfigPanel();

    try {
      const removeButton = await waitForQuerySelector<HTMLButtonElement>(
        testRoot.container,
        '[aria-label="Remove Support room"]',
      );
      await clickAndFlush(removeButton);

      const dialog = await waitForTestId<HTMLElement>(document.body, "confirm-danger-dialog");
      expect(dialog.textContent).toContain("Remove routing rule");
      expect(dialog.textContent).toContain("Support room");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("opens the revert confirmation dialog from history", async () => {
    const { testRoot } = renderRoutingConfigPanel();

    try {
      const revertButton = await waitForQuerySelector<HTMLButtonElement>(
        testRoot.container,
        '[aria-label="Revert to revision 1"]',
      );
      await clickAndFlush(revertButton);

      const dialog = await waitForTestId<HTMLElement>(document.body, "confirm-danger-dialog");
      expect(dialog.textContent).toContain("Revert routing revision");
      expect(dialog.textContent).toContain("Revert Telegram routing to revision 1.");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("shows empty rules and history states when no routing data exists", async () => {
    const { testRoot } = renderRoutingConfigPanel((core) => {
      core.admin.routingConfig.get = vi.fn(async () => ({ revision: 1, config: { v: 1 } }));
      core.admin.routingConfig.listRevisions = vi.fn(async () => ({ revisions: [] }));
      core.admin.routingConfig.listObservedTelegramThreads = vi.fn(async () => ({ threads: [] }));
    });

    try {
      await waitForTestId(testRoot.container, "admin-http-routing-config");
      await waitForText(testRoot.container, "No Telegram routing rules configured");
      expect(testRoot.container.textContent).toContain("No routing revisions yet");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
