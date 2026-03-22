// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { AgentsPage } from "../../src/components/pages/agents-page.js";
import { cleanupTestRoot, click, renderIntoDocument } from "../test-utils.js";
import { createCore, flush } from "./agents-page.test-support.tsx";

describe("AgentsPage layout", () => {
  it("uses the full page width for the merged operate layout", async () => {
    const { core } = createCore();
    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    const contentLayout = testRoot.container.querySelector<HTMLDivElement>(
      '[data-testid="agents-content-layout"]',
    );
    expect(contentLayout?.className).toContain("grid-cols-1");
    expect(contentLayout?.className).toContain("lg:grid-cols-[320px_minmax(0,1fr)_320px]");

    const layoutContent = testRoot.container.querySelector<HTMLElement>("[data-layout-content]");
    expect(layoutContent?.className).toContain("max-w-none");
    expect(layoutContent?.className).not.toContain("max-w-5xl");

    const transcriptsPanel = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="transcripts-page"]',
    );
    expect(transcriptsPanel).not.toBeNull();
    expect(testRoot.container.textContent).not.toContain("Identity");

    cleanupTestRoot(testRoot);
  });

  it("opens the editor in a dialog instead of rendering an inline editor tab", async () => {
    const { core } = createCore();
    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    expect(testRoot.container.querySelector('[data-testid="agents-editor"]')).toBeNull();

    await act(async () => {
      click(testRoot.container.querySelector<HTMLElement>('[data-testid="agents-edit-default"]')!);
      await Promise.resolve();
    });

    const dialog = document.querySelector<HTMLElement>('[data-testid="agents-editor-dialog"]');
    expect(dialog).not.toBeNull();
    expect(document.body.textContent).toContain("Edit Feynman");

    cleanupTestRoot(testRoot);
  });
});
