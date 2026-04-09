import type { CliCommand } from "../cli-command.js";
import { resolveOperatorConfigPath } from "../operator-paths.js";
import { loadOperatorConfig, saveOperatorConfig } from "../operator-state.js";

export async function handleConfigShow(
  _command: Extract<CliCommand, { kind: "config_show" }>,
  home: string,
): Promise<number> {
  try {
    const configPath = resolveOperatorConfigPath(home);
    const config = await loadOperatorConfig(configPath);
    const maskedToken = config.auth_token ? "[set]" : "[unset]";
    console.log(
      [
        "operator config",
        `home=${home}`,
        `gateway_url=${config.gateway_url ?? "[unset]"}`,
        `auth_token=${maskedToken}`,
        `tls_cert_fingerprint256=${config.tls_cert_fingerprint256 ?? "[unset]"}`,
      ].join(" "),
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`config.show: failed: ${message}`);
    return 1;
  }
}

export async function handleConfigSet(
  command: Extract<CliCommand, { kind: "config_set" }>,
  home: string,
): Promise<number> {
  try {
    const configPath = resolveOperatorConfigPath(home);
    await saveOperatorConfig(configPath, {
      gateway_url: command.gateway_url,
      auth_token: command.auth_token,
      ...(command.tls_cert_fingerprint256
        ? { tls_cert_fingerprint256: command.tls_cert_fingerprint256 }
        : {}),
    });
    console.log(`config.set: ok path=${configPath}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`config.set: failed: ${message}`);
    return 1;
  }
}
