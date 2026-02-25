/**
 * Input sanitization for untrusted content entering the agent context.
 *
 * Applies deterministic pattern escaping and clear data delimiters
 * to mitigate prompt injection attacks from external sources
 * (web pages, tool outputs, email content, etc.).
 */

import type { TaggedContent } from "./provenance.js";

/**
 * Patterns that indicate prompt injection attempts.
 * Each entry is [regex, replacement description].
 */
const INJECTION_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // Role impersonation — attempts to hijack the system/developer/assistant role
  [/\b(system|developer|assistant)\s*:/gi, "[role-ref] $1:"],
  // Instruction override — phrases that try to override prior instructions
  [
    /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
    "[blocked-override]",
  ],
  [
    /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
    "[blocked-override]",
  ],
  [
    /forget\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
    "[blocked-override]",
  ],
  // "You are now" re-identity attempts
  [/you\s+are\s+now\b/gi, "[blocked-reidentity]"],
  // "New instructions:" / "Updated instructions:" headers
  [/\b(new|updated|revised|override)\s+instructions?\s*:/gi, "[blocked-header]"],
  // "Do not follow" / "Stop following" directives
  [
    /(do\s+not|don'?t|stop)\s+follow(ing)?\s+(the\s+)?(system|previous|original)/gi,
    "[blocked-directive]",
  ],
  // Attempts to extract system prompt
  [
    /\b(show|print|display|output|reveal|repeat)\s+(your|the)\s+(system\s+)?(prompt|instructions?|rules?)\b/gi,
    "[blocked-extraction]",
  ],
];

/**
 * Sanitize content for safe inclusion in the model context.
 *
 * Trusted content is returned as-is. Untrusted content is:
 * 1. Scanned for known injection patterns (escaped/replaced)
 * 2. Wrapped in clear data delimiters indicating the source
 */
export function sanitizeForModel(tagged: TaggedContent): string {
  if (tagged.trusted) {
    return tagged.content;
  }

  let sanitized = tagged.content;

  for (const [pattern, replacement] of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  return `<data source="${tagged.source}">\n${sanitized}\n</data>`;
}

/**
 * Check whether content contains potential injection patterns.
 * Useful for policy checks without modifying the content.
 */
export function containsInjectionPatterns(content: string): boolean {
  for (const [pattern] of INJECTION_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      pattern.lastIndex = 0;
      return true;
    }
  }
  return false;
}
