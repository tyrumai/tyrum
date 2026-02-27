import type { MenuItemConstructorOptions } from "electron";

export interface NavigationRequest {
  pageId: "connection";
}

export interface BuildApplicationMenuTemplateOptions {
  appName: string;
  platform: NodeJS.Platform;
  isDev: boolean;
  onRequestNavigate: (request: NavigationRequest) => void;
  onShowAbout: () => void;
}

export function buildApplicationMenuTemplate(
  options: BuildApplicationMenuTemplateOptions,
): MenuItemConstructorOptions[] {
  const isMac = options.platform === "darwin";

  const requestOpenSettings = (): void => {
    options.onRequestNavigate({ pageId: "connection" });
  };

  const editMenu: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "delete" },
      { role: "selectAll" },
    ],
  };

  const viewSubmenu: MenuItemConstructorOptions[] = [
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];

  if (options.isDev) {
    viewSubmenu.push(
      { type: "separator" },
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
    );
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: viewSubmenu,
  };

  if (isMac) {
    const appMenu: MenuItemConstructorOptions = {
      label: options.appName,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Preferences…",
          accelerator: "CmdOrCtrl+,",
          click: requestOpenSettings,
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    };

    const fileMenu: MenuItemConstructorOptions = {
      label: "File",
      submenu: [{ role: "close" }],
    };

    const windowMenu: MenuItemConstructorOptions = {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }],
    };

    return [appMenu, fileMenu, editMenu, viewMenu, windowMenu];
  }

  const helpMenu: MenuItemConstructorOptions = {
    label: "Help",
    submenu: [
      {
        label: `About ${options.appName}`,
        click: options.onShowAbout,
      },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      { role: "close" },
      { type: "separator" },
      {
        label: "Settings…",
        accelerator: "CmdOrCtrl+,",
        click: requestOpenSettings,
      },
      { type: "separator" },
      { role: "quit", label: "Exit" },
    ],
  };

  return [fileMenu, editMenu, viewMenu, helpMenu];
}
