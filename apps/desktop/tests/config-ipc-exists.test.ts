import { beforeEach, describe, expect, it, vi } from "vitest";

const { ipcMainHandleMock, registeredHandlers, configExistsMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
  registeredHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  configExistsMock: vi.fn(() => false),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: ipcMainHandleMock },
  nativeTheme: { themeSource: "system" },
  shell: { openExternal: vi.fn() },
}));

vi.mock("../src/main/config/store.js", () => ({
  configExists: configExistsMock,
  loadConfig: vi.fn(() => ({ mode: "embedded" })),
  saveConfig: vi.fn(),
}));

describe("config-ipc config:exists handler", () => {
  beforeEach(() => {
    vi.resetModules();
    registeredHandlers.clear();
    ipcMainHandleMock.mockReset();
    ipcMainHandleMock.mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        registeredHandlers.set(channel, handler);
      },
    );
    configExistsMock.mockReset();
    configExistsMock.mockReturnValue(false);
  });

  it("returns whether the desktop config file exists", { timeout: 15_000 }, async () => {
    const { registerConfigIpc } = await import("../src/main/ipc/config-ipc.js");
    registerConfigIpc();

    const handler = registeredHandlers.get("config:exists");
    expect(handler).toBeTypeOf("function");

    configExistsMock.mockReturnValueOnce(true);
    expect(handler?.({} as never)).toBe(true);

    configExistsMock.mockReturnValueOnce(false);
    expect(handler?.({} as never)).toBe(false);
  });
});
