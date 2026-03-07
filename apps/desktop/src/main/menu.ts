import type { MenuItemConstructorOptions } from "electron";

export interface NavigationRequest {
  pageId: "node-configure";
}

export interface BuildApplicationMenuTemplateOptions {
  appName: string;
  platform: NodeJS.Platform;
  isDev: boolean;
  onRequestNavigate: (request: NavigationRequest) => void;
  onShowAbout: () => void;
}

function buildEditMenu(): MenuItemConstructorOptions {
  return {
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
}

function buildViewMenu(isDev: boolean): MenuItemConstructorOptions {
  const submenu: MenuItemConstructorOptions[] = [
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];

  if (isDev) {
    submenu.push(
      { type: "separator" },
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
    );
  }

  return {
    label: "View",
    submenu,
  };
}

function buildMacAppMenu(options: {
  appName: string;
  requestOpenSettings: () => void;
}): MenuItemConstructorOptions {
  return {
    label: options.appName,
    submenu: [
      { role: "about" },
      { type: "separator" },
      {
        label: "Preferences…",
        accelerator: "CmdOrCtrl+,",
        click: options.requestOpenSettings,
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
}

function buildMacWindowMenu(): MenuItemConstructorOptions {
  return {
    label: "Window",
    submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }],
  };
}

function buildNonMacFileMenu(options: {
  requestOpenSettings: () => void;
}): MenuItemConstructorOptions {
  return {
    label: "File",
    submenu: [
      { role: "close" },
      { type: "separator" },
      {
        label: "Settings…",
        accelerator: "CmdOrCtrl+,",
        click: options.requestOpenSettings,
      },
      { type: "separator" },
      { role: "quit", label: "Exit" },
    ],
  };
}

function buildNonMacHelpMenu(options: {
  appName: string;
  onShowAbout: () => void;
}): MenuItemConstructorOptions {
  return {
    label: "Help",
    submenu: [
      {
        label: `About ${options.appName}`,
        click: options.onShowAbout,
      },
    ],
  };
}

export function buildApplicationMenuTemplate(
  options: BuildApplicationMenuTemplateOptions,
): MenuItemConstructorOptions[] {
  const requestOpenSettings = (): void => {
    options.onRequestNavigate({ pageId: "node-configure" });
  };

  const editMenu = buildEditMenu();
  const viewMenu = buildViewMenu(options.isDev);

  if (options.platform === "darwin") {
    const fileMenu: MenuItemConstructorOptions = { label: "File", submenu: [{ role: "close" }] };
    return [
      buildMacAppMenu({ appName: options.appName, requestOpenSettings }),
      fileMenu,
      editMenu,
      viewMenu,
      buildMacWindowMenu(),
    ];
  }

  return [
    buildNonMacFileMenu({ requestOpenSettings }),
    editMenu,
    viewMenu,
    buildNonMacHelpMenu({ appName: options.appName, onShowAbout: options.onShowAbout }),
  ];
}
