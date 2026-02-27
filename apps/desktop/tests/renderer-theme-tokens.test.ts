// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

describe("renderer theme tokens", () => {
  beforeEach(() => {
    document.documentElement.style.cssText = "";
    document.documentElement.removeAttribute("data-theme");
  });

  it("applies light theme token values as CSS variables", async () => {
    const theme = await import("../src/renderer/theme.ts");

    expect(theme.desktopThemeTokens).toBeDefined();
    if (!theme.desktopThemeTokens) return;

    expect(theme.applyDesktopThemeState).toBeTypeOf("function");
    if (typeof theme.applyDesktopThemeState !== "function") return;

    theme.applyDesktopThemeState({
      colorScheme: "light",
      highContrast: false,
      inverted: false,
      source: "system",
    });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--tyrum-color-bg")).toBe(
      theme.desktopThemeTokens.light.bg,
    );
  });

  it("applies dark theme token values as CSS variables", async () => {
    const theme = await import("../src/renderer/theme.ts");

    expect(theme.desktopThemeTokens).toBeDefined();
    if (!theme.desktopThemeTokens) return;

    expect(theme.applyDesktopThemeState).toBeTypeOf("function");
    if (typeof theme.applyDesktopThemeState !== "function") return;

    theme.applyDesktopThemeState({
      colorScheme: "dark",
      highContrast: false,
      inverted: false,
      source: "system",
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--tyrum-color-bg")).toBe(
      theme.desktopThemeTokens.dark.bg,
    );
  });
});
