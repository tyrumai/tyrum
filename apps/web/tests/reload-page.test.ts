// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { reloadPage } from "../src/reload-page.js";

describe("reloadPage", () => {
  it("reloads the current browser location", () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        reload,
      },
    });

    reloadPage();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
