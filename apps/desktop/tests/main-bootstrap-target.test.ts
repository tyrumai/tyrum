import { describe, expect, it } from "vitest";
import { resolveBootstrapTarget } from "../src/main/bootstrap-target.js";

describe("resolveBootstrapTarget", () => {
  it("starts the desktop app when not running under Electron-as-Node", () => {
    expect(
      resolveBootstrapTarget({
        env: {},
        argv: ["/Applications/Tyrum.app/Contents/MacOS/Tyrum"],
        bootstrapModuleUrl: "file:///repo/apps/desktop/src/main/bootstrap-target.ts",
      }),
    ).toEqual({ kind: "app" });
  });

  it("delegates to the requested script when Electron-as-Node passes a child entrypoint", () => {
    expect(
      resolveBootstrapTarget({
        env: { ELECTRON_RUN_AS_NODE: "1" },
        argv: [
          "/Applications/Tyrum.app/Contents/MacOS/Tyrum",
          "/Applications/Tyrum.app/Contents/Resources/app.asar/dist/gateway/index.mjs",
          "start",
        ],
        bootstrapModuleUrl: "file:///repo/apps/desktop/src/main/bootstrap.ts",
      }),
    ).toEqual({
      kind: "delegate",
      scriptPath: "/Applications/Tyrum.app/Contents/Resources/app.asar/dist/gateway/index.mjs",
    });
  });

  it("does not recurse when Electron-as-Node points back at the bootstrap entrypoint", () => {
    expect(
      resolveBootstrapTarget({
        env: { ELECTRON_RUN_AS_NODE: "1" },
        argv: [
          "/Applications/Tyrum.app/Contents/MacOS/Tyrum",
          "/repo/apps/desktop/src/main/bootstrap.ts",
        ],
        bootstrapModuleUrl: "file:///repo/apps/desktop/src/main/bootstrap.ts",
      }),
    ).toEqual({ kind: "app" });
  });
});
