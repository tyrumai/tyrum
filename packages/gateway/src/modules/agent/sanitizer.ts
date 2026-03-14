import type { TaggedContent } from "./provenance.js";

const INJECTION_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\b(system|developer|assistant)\s*:/gi, "[role-ref] $1:"],
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
  [/you\s+are\s+now\b/gi, "[blocked-reidentity]"],
  [/\b(new|updated|revised|override)\s+instructions?\s*:/gi, "[blocked-header]"],
  [
    /(do\s+not|don'?t|stop)\s+follow(ing)?\s+(the\s+)?(system|previous|original)/gi,
    "[blocked-directive]",
  ],
  [
    /\b(show|print|display|output|reveal|repeat)\s+(your|the)\s+(system\s+)?(prompt|instructions?|rules?)\b/gi,
    "[blocked-extraction]",
  ],
];

export function sanitizeForModel(tagged: TaggedContent): string {
  if (tagged.trusted) {
    return tagged.content;
  }

  let sanitized = tagged.content;

  for (const [pattern, replacement] of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  sanitized = sanitized.replace(/<\s*\/\s*data\s*>/gi, "&lt;/data&gt;");
  sanitized = sanitized.replace(/<\s*data\b/gi, "&lt;data");

  return `<data source="${tagged.source}">\n${sanitized}\n</data>`;
}

export function containsInjectionPatterns(content: string): boolean {
  for (const [pattern] of INJECTION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      pattern.lastIndex = 0;
      return true;
    }
  }
  return false;
}
