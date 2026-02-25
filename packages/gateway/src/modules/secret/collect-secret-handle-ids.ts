export function collectSecretHandleIds(args: unknown): string[] {
  const out = new Set<string>();

  const walk = (value: unknown): void => {
    if (typeof value === "string" && value.startsWith("secret:")) {
      const id = value.slice("secret:".length).trim();
      if (id) out.add(id);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) {
        walk(v);
      }
    }
  };

  walk(args);
  return [...out];
}
