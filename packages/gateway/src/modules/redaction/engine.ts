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
  return Array.from(unique).sort((a, b) => {
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

/**
 * Common patterns for secrets and credentials.
 * Returns an array of pattern descriptions that matched.
 */
export function scanForSecretPatterns(text: string): string[] {
  const matches: string[] = [];

  const patterns: Array<{ name: string; regex: RegExp }> = [
    // API keys (generic prefixed keys)
    { name: "api_key_prefix", regex: /\b(?:sk|pk|api|key|token|secret|bearer)[_-][a-zA-Z0-9]{20,}\b/i },
    // AWS access key
    { name: "aws_access_key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
    // AWS secret key
    { name: "aws_secret_key", regex: /\b[0-9a-zA-Z/+]{40}\b/ },
    // GitHub token
    { name: "github_token", regex: /\bgh[ps]_[a-zA-Z0-9]{36,}\b/ },
    { name: "github_fine_grained_token", regex: /\bgithub_pat_[a-zA-Z0-9_]{22,}\b/ },
    // Slack tokens
    { name: "slack_token", regex: /\bxox[baprs]-[0-9a-zA-Z-]{10,}\b/ },
    // Generic JWT
    { name: "jwt_token", regex: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\b/ },
    // Private key markers
    { name: "private_key", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
    // Password assignments
    { name: "password_assignment", regex: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}["']/i },
    // Connection strings with credentials
    { name: "connection_string", regex: /(?:postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@/i },
  ];

  for (const { name, regex } of patterns) {
    if (regex.test(text)) {
      matches.push(name);
    }
  }

  return matches;
}

