const TRUTHY_VALUES = new Set(["1", "true", "on", "yes"]);
const FALSY_VALUES = new Set(["0", "false", "off", "no"]);

export function readBooleanEnv(
  name: string,
  defaultValue: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const normalized = env[name]?.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (TRUTHY_VALUES.has(normalized)) return true;
  if (FALSY_VALUES.has(normalized)) return false;
  return defaultValue;
}

