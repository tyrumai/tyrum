import { describe, expect, it, vi } from "vitest";
import { buildApplicationMenuTemplate } from "../src/main/menu.js";

describe("buildApplicationMenuTemplate", () => {
  it("builds a standard macOS app + window menu with Preferences navigation", () => {
    const onRequestNavigate = vi.fn();

    const template = buildApplicationMenuTemplate({
      appName: "Tyrum",
      platform: "darwin",
      isDev: false,
      onRequestNavigate,
    });

    const appMenu = template.find((item) => item.label === "Tyrum");
    expect(appMenu).toBeDefined();
    expect(Array.isArray(appMenu?.submenu)).toBe(true);

    const preferencesItem = (appMenu?.submenu ?? []).find((item) => item?.label === "Preferences…");
    expect(preferencesItem).toBeDefined();
    expect(preferencesItem?.accelerator).toBe("CmdOrCtrl+,");
    expect(typeof preferencesItem?.click).toBe("function");

    preferencesItem?.click?.({} as never, null, {} as never);
    expect(onRequestNavigate).toHaveBeenCalledWith({ pageId: "connection" });

    const windowMenu = template.find((item) => item.label === "Window");
    expect(windowMenu).toBeDefined();
  });

  it("builds File/Edit/View/Help on Windows and includes dev tools only in dev", () => {
    const onRequestNavigate = vi.fn();
    const onShowAbout = vi.fn();

    const devTemplate = buildApplicationMenuTemplate({
      appName: "Tyrum",
      platform: "win32",
      isDev: true,
      onRequestNavigate,
      onShowAbout,
    });

    expect(devTemplate.map((item) => item.label)).toEqual(
      expect.arrayContaining(["File", "Edit", "View", "Help"]),
    );

    const devViewMenu = devTemplate.find((item) => item.label === "View");
    expect(devViewMenu).toBeDefined();
    expect(Array.isArray(devViewMenu?.submenu)).toBe(true);
    expect((devViewMenu?.submenu ?? []).some((item) => item?.role === "toggleDevTools")).toBe(true);

    const prodTemplate = buildApplicationMenuTemplate({
      appName: "Tyrum",
      platform: "win32",
      isDev: false,
      onRequestNavigate,
      onShowAbout,
    });

    const prodViewMenu = prodTemplate.find((item) => item.label === "View");
    expect(prodViewMenu).toBeDefined();
    expect((prodViewMenu?.submenu ?? []).some((item) => item?.role === "toggleDevTools")).toBe(
      false,
    );

    const fileMenu = prodTemplate.find((item) => item.label === "File");
    expect(fileMenu).toBeDefined();

    const settingsItem = (fileMenu?.submenu ?? []).find((item) => item?.label === "Settings…");
    expect(settingsItem).toBeDefined();
    expect(settingsItem?.accelerator).toBe("CmdOrCtrl+,");

    settingsItem?.click?.({} as never, null, {} as never);
    expect(onRequestNavigate).toHaveBeenCalledWith({ pageId: "connection" });

    const helpMenu = prodTemplate.find((item) => item.label === "Help");
    expect(helpMenu).toBeDefined();

    const aboutItem = (helpMenu?.submenu ?? []).find((item) => item?.label === "About Tyrum");
    expect(aboutItem).toBeDefined();
    aboutItem?.click?.({} as never, null, {} as never);
    expect(onShowAbout).toHaveBeenCalledTimes(1);
  });
});
