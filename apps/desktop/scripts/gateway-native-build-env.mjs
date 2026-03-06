const CONFLICTING_ELECTRON_BUILD_ENV_KEYS = [
  "npm_config_arch",
  "npm_config_disturl",
  "npm_config_nodedir",
  "npm_config_runtime",
  "npm_config_target",
];

export function createElectronNativeBuildEnv(baseEnv = process.env) {
  const env = { ...baseEnv };

  for (const key of CONFLICTING_ELECTRON_BUILD_ENV_KEYS) {
    delete env[key];
  }

  return env;
}
