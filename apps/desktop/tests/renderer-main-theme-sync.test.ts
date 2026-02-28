// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRootMock, renderMock, ThemeProviderMock, ErrorBoundaryMock } = vi.hoisted(() => {
  const renderMock = vi.fn();
  const createRootMock = vi.fn(() => ({ render: renderMock }));
  const ThemeProviderMock = vi.fn(({ children }: { children: unknown }) => children);
  const ErrorBoundaryMock = vi.fn(({ children }: { children: unknown }) => children);

  return { createRootMock, renderMock, ThemeProviderMock, ErrorBoundaryMock };
});

vi.mock("react-dom/client", () => ({
  createRoot: createRootMock,
}));

vi.mock("@tyrum/operator-ui", () => ({
  ThemeProvider: ThemeProviderMock,
  ErrorBoundary: ErrorBoundaryMock,
}));

vi.mock("../src/renderer/App.js", () => ({
  App: () => null,
}));

describe("renderer bootstrap theme sync", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("wraps the app in ThemeProvider", async () => {
    await import("../src/renderer/main.tsx");

    expect(renderMock).toHaveBeenCalledTimes(1);
    const element = renderMock.mock.calls[0]?.[0] as { type?: unknown } | undefined;
    expect(element?.type).toBe(ThemeProviderMock);
  });
});
