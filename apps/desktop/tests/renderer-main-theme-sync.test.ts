// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRootMock, renderMock, startDesktopThemeSyncMock } = vi.hoisted(() => {
  const renderMock = vi.fn();
  const createRootMock = vi.fn(() => ({ render: renderMock }));
  const startDesktopThemeSyncMock = vi.fn(() => new Promise<() => void>(() => {}));

  return { createRootMock, renderMock, startDesktopThemeSyncMock };
});

vi.mock("react-dom/client", () => ({
  createRoot: createRootMock,
}));

vi.mock("../src/renderer/App.js", () => ({
  App: () => null,
}));

vi.mock("../src/renderer/theme.js", () => ({
  startDesktopThemeSync: startDesktopThemeSyncMock,
}));

describe("renderer bootstrap theme sync", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="root"></div>';
    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = {
      theme: {
        getState: vi.fn(async () => ({
          colorScheme: "dark",
          highContrast: false,
          inverted: false,
          source: "system",
        })),
        onChange: vi.fn(() => () => {}),
      },
    };
  });

  it("renders even when desktop theme sync is still pending", async () => {
    await import("../src/renderer/main.tsx");

    await Promise.resolve();

    expect(startDesktopThemeSyncMock).toHaveBeenCalledTimes(1);
    expect(renderMock).toHaveBeenCalledTimes(1);
  });
});
