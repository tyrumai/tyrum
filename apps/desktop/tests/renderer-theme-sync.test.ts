// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("renderer theme sync", () => {
  beforeEach(() => {
    document.documentElement.style.cssText = "";
    document.documentElement.removeAttribute("data-theme");
  });

  it("applies initial state and subscribes to theme updates", async () => {
    const theme = await import("../src/renderer/theme.ts");

    expect(theme.startDesktopThemeSync).toBeTypeOf("function");
    if (typeof theme.startDesktopThemeSync !== "function") return;

    const getState = vi.fn(async () => ({
      colorScheme: "light" as const,
      highContrast: false,
      inverted: false,
      source: "system" as const,
    }));

    let onChangeCallback: ((state: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const onChange = vi.fn((cb: (state: unknown) => void) => {
      onChangeCallback = cb;
      return unsubscribe;
    });

    const stop = await theme.startDesktopThemeSync({
      getState,
      onChange,
    });

    expect(getState).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(stop).toBe(unsubscribe);
    expect(document.documentElement.dataset.theme).toBe("light");

    onChangeCallback?.({
      colorScheme: "dark",
      highContrast: false,
      inverted: false,
      source: "system",
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
