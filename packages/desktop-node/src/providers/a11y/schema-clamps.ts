export const MAX_ROLE_CHARS = 64;
export const MAX_NAME_CHARS = 512;
export const MAX_VALUE_CHARS = 512;
export const MAX_STATE_CHARS = 64;
export const MAX_ACTION_CHARS = 64;

export const MAX_NODE_STATES = 32;
export const MAX_NODE_ACTIONS = 32;
export const MAX_NODE_CHILDREN = 128;

export function clampTrimmed(value: string, maxChars: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}
