// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as operatorUi from "../src/index.js";
import { stubMatchMedia } from "./test-utils.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createTestRoot(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

describe("useMediaQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  it("returns false when matchMedia is not available", async () => {
    const useMediaQuery = (operatorUi as Record<string, unknown>)["useMediaQuery"];
    expect(useMediaQuery).toBeDefined();

    const { container, root } = createTestRoot();

    let value: boolean | null = null;
    const Probe = () => {
      value = (useMediaQuery as (query: string) => boolean)("(min-width: 768px)");
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe, null));
      await Promise.resolve();
    });

    expect(value).toBe(false);

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("tracks matchMedia and updates on change events", async () => {
    const useMediaQuery = (operatorUi as Record<string, unknown>)["useMediaQuery"];
    expect(useMediaQuery).toBeDefined();

    const matchMedia = stubMatchMedia("(min-width: 768px)", false);
    const { container, root } = createTestRoot();

    let value: boolean | null = null;
    const Probe = () => {
      value = (useMediaQuery as (query: string) => boolean)("(min-width: 768px)");
      return null;
    };

    await act(async () => {
      root.render(React.createElement(Probe, null));
      await Promise.resolve();
    });

    expect(value).toBe(false);

    act(() => {
      matchMedia.setMatches(true);
    });

    expect(value).toBe(true);

    act(() => {
      root.unmount();
    });
    container.remove();
    matchMedia.cleanup();
  });
});
