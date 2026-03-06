import { describe, expect, it } from "vitest";
import { createElectronNativeBuildEnv } from "../scripts/gateway-native-build-env.mjs";

describe("createElectronNativeBuildEnv", () => {
  it("removes npm electron build settings that can override the requested target", () => {
    const input = {
      KEEP_ME: "1",
      npm_config_arch: "arm64",
      npm_config_disturl: "https://nodejs.org/dist",
      npm_config_nodedir: "/tmp/node",
      npm_config_runtime: "node",
      npm_config_target: "24.14.0",
    };

    const env = createElectronNativeBuildEnv(input);

    expect(env).toEqual({
      KEEP_ME: "1",
    });
    expect(input.npm_config_nodedir).toBe("/tmp/node");
  });
});
