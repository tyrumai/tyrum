const DISABLED_VALUES = new Set(["0", "false", "off", "no"]);

export function isAgentEnabled(): boolean {
  const raw = process.env["TYRUM_AGENT_ENABLED"]?.trim();
  if (!raw) return true;
  return !DISABLED_VALUES.has(raw.toLowerCase());
}

