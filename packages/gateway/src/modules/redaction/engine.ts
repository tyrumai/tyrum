export interface RedactionOutcome<T> {
  redacted: T;
  /** JSON Pointer paths that were modified. */
  redactions: string[];
}

function escapeJsonPointerToken(token: string): string {
  return token.replaceAll("~", "~0").replaceAll("/", "~1");
}

function normalizedSecrets(input: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const raw of input) {
    const s = typeof raw === "string" ? raw : "";
    if (s.length > 0) unique.add(s);
  }
  return Array.from(unique).toSorted((a, b) => {
    const len = b.length - a.length;
    if (len !== 0) return len;
    return a.localeCompare(b);
  });
}

export function redactText(
  text: string,
  secrets: readonly string[],
): { redacted: string; changed: boolean } {
  if (text.length === 0) return { redacted: text, changed: false };
  const ordered = normalizedSecrets(secrets);
  if (ordered.length === 0) return { redacted: text, changed: false };

  let result = text;
  let changed = false;
  for (const secret of ordered) {
    if (secret.length === 0) continue;
    if (!result.includes(secret)) continue;
    result = result.replaceAll(secret, "[REDACTED]");
    changed = true;
  }
  return { redacted: result, changed };
}

export function redactUnknown(
  value: unknown,
  secrets: readonly string[],
): RedactionOutcome<unknown> {
  const ordered = normalizedSecrets(secrets);
  const redactions: string[] = [];

  const walk = (v: unknown, path: string): unknown => {
    if (typeof v === "string") {
      const { redacted, changed } = redactText(v, ordered);
      if (changed) redactions.push(path || "");
      return redacted;
    }
    if (Array.isArray(v)) {
      return v.map((entry, idx) => walk(entry, `${path}/${idx}`));
    }
    if (v !== null && typeof v === "object") {
      // Only handle plain JSON-ish objects; preserve prototypes by copying
      // enumerable own props into a POJO.
      const obj = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(obj)) {
        const nextPath = `${path}/${escapeJsonPointerToken(k)}`;
        out[k] = walk(child, nextPath);
      }
      return out;
    }
    return v;
  };

  const redacted = walk(value, "");
  return { redacted, redactions };
}

/**
 * Central in-memory redaction engine.
 *
 * Register secret values as they are resolved, then use `redactUnknown`/`redactText`
 * at persistence + egress boundaries.
 */
export class RedactionEngine {
  private readonly secrets = new Set<string>();

  registerSecrets(values: readonly string[]): void {
    for (const v of values) {
      if (typeof v === "string" && v.length > 0) {
        this.secrets.add(v);
      }
    }
  }

  redactText(text: string): { redacted: string; changed: boolean } {
    return redactText(text, Array.from(this.secrets));
  }

  redactUnknown(value: unknown): RedactionOutcome<unknown> {
    return redactUnknown(value, Array.from(this.secrets));
  }
}
