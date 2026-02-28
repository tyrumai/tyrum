// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("Memory page padding", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = '<div id="root"></div>';
    container = document.getElementById("root")!;
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
  });

  it("does not add extra inner padding in fallback states", async () => {
    const { Memory } = await import("../src/renderer/pages/Memory.js");

    const render = async (props: Parameters<typeof Memory>[0]) => {
      await act(async () => {
        root.render(createElement(Memory, props));
      });

      const rootElement = container.firstElementChild;
      if (!(rootElement instanceof HTMLElement)) {
        throw new Error("expected Memory page to render an element");
      }
      return rootElement;
    };

    delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
    const noApi = await render({ core: null, busy: false, errorMessage: null });
    expect(noApi.style.padding).toBe("");
    expect(container.textContent).toContain("Desktop API not available.");

    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = {};
    const error = await render({ core: null, busy: false, errorMessage: "boom" });
    expect(error.style.padding).toBe("");
    expect(container.textContent).toContain("boom");

    const loading = await render({ core: null, busy: true, errorMessage: null });
    expect(loading.style.padding).toBe("");
    expect(container.textContent).toContain("Loading memory...");
  });
});
