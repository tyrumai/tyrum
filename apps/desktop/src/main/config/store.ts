import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { DesktopNodeConfig, DEFAULT_CONFIG } from "./schema.js";

function getConfigDir(): string {
  return process.env["TYRUM_HOME"] ?? join(homedir(), ".tyrum");
}

function getConfigPath(): string {
  return join(getConfigDir(), "desktop-node.json");
}

export function configExists(): boolean {
  return existsSync(getConfigPath());
}

export function loadConfig(): DesktopNodeConfig {
  const path = getConfigPath();
  if (!existsSync(path)) return structuredClone(DEFAULT_CONFIG);
  const raw = readFileSync(path, "utf-8");
  return DesktopNodeConfig.parse(JSON.parse(raw));
}

export function saveConfig(config: DesktopNodeConfig): void {
  const path = getConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}
