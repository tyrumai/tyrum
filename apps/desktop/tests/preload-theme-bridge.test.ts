import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  exposeInMainWorldMock,
  ipcRendererInvokeMock,
  ipcRendererOnMock,
  ipcRendererRemoveListenerMock,
} = vi.hoisted(() => {
  return {
    exposeInMainWorldMock: vi.fn(),
    ipcRendererInvokeMock: vi.fn(),
    ipcRendererOnMock: vi.fn(),
    ipcRendererRemoveListenerMock: vi.fn(),
  };
});

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: exposeInMainWorldMock,
  },
  ipcRenderer: {
    invoke: ipcRendererInvokeMock,
    on: ipcRendererOnMock,
    removeListener: ipcRendererRemoveListenerMock,
  },
}));

async function importPreloadApi(): Promise<unknown> {
  vi.resetModules();
  exposeInMainWorldMock.mockClear();
  ipcRendererInvokeMock.mockReset();
  ipcRendererOnMock.mockReset();
  ipcRendererRemoveListenerMock.mockReset();

  await import("../src/preload/index.ts");

  const api = exposeInMainWorldMock.mock.calls[0]?.[1];
  expect(api).toBeDefined();
  return api;
}

describe("preload theme bridge", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("exposes theme state getters and subscription helpers", async () => {
    const api = (await importPreloadApi()) as { theme?: unknown };

    expect(api.theme).toBeDefined();
    expect(api.theme).toMatchObject({
      getState: expect.any(Function),
      onChange: expect.any(Function),
    });
  });

  it("theme.getState invokes the main theme handler", async () => {
    const api = (await importPreloadApi()) as { theme?: { getState?: () => Promise<unknown> } };

    expect(api.theme?.getState).toBeTypeOf("function");
    if (typeof api.theme?.getState !== "function") return;

    const state = { colorScheme: "dark", highContrast: false };
    ipcRendererInvokeMock.mockResolvedValue(state);

    await expect(api.theme.getState()).resolves.toEqual(state);
    expect(ipcRendererInvokeMock).toHaveBeenCalledWith("theme:get-state");
  });

  it("theme.onChange subscribes to theme updates and can unsubscribe", async () => {
    const api = (await importPreloadApi()) as {
      theme?: { onChange?: (cb: (state: unknown) => void) => () => void };
    };

    expect(api.theme?.onChange).toBeTypeOf("function");
    if (typeof api.theme?.onChange !== "function") return;

    const callback = vi.fn();
    const unsubscribe = api.theme.onChange(callback);
    expect(unsubscribe).toBeTypeOf("function");

    expect(ipcRendererOnMock).toHaveBeenCalledWith("theme:state", expect.any(Function));
    const listener = ipcRendererOnMock.mock.calls[0]?.[1] as
      | ((event: unknown, state: unknown) => void)
      | undefined;
    expect(listener).toBeTypeOf("function");

    listener?.({}, { colorScheme: "light", highContrast: false });
    expect(callback).toHaveBeenCalledWith({ colorScheme: "light", highContrast: false });

    unsubscribe();
    expect(ipcRendererRemoveListenerMock).toHaveBeenCalledWith("theme:state", listener);
  });
});
