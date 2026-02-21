/**
 * Wildcard pattern matching for policy overrides.
 *
 * Grammar (per architecture docs):
 * - `*` matches zero or more characters
 * - `?` matches exactly one character
 * - No regex
 *
 * Patterns are case-sensitive.
 */

/**
 * Convert a wildcard pattern to a RegExp.
 * Escapes all regex metacharacters except `*` and `?`.
 */
export function wildcardToRegex(pattern: string): RegExp {
  let regex = "";
  for (const ch of pattern) {
    if (ch === "*") {
      regex += ".*";
    } else if (ch === "?") {
      regex += ".";
    } else if (".+^${}()|[]\\".includes(ch)) {
      regex += "\\" + ch;
    } else {
      regex += ch;
    }
  }
  return new RegExp(`^${regex}$`);
}

/**
 * Test whether a target string matches a wildcard pattern.
 */
export function matchesWildcard(pattern: string, target: string): boolean {
  return wildcardToRegex(pattern).test(target);
}
