/**
 * Provenance tagging for agent content.
 *
 * Every piece of content flowing into the agent's context is tagged
 * with its origin and trust level. This metadata drives downstream
 * sanitization and policy decisions.
 */

/** Content origin categories. */
export type ProvenanceTag = "user" | "email" | "web" | "tool" | "memory" | "semantic-memory";

/** Content wrapped with provenance metadata. */
export interface TaggedContent {
  content: string;
  source: ProvenanceTag;
  trusted: boolean;
}

/** Sources that are trusted by default (direct human input, local memory). */
const TRUSTED_SOURCES = new Set<ProvenanceTag>(["user", "memory", "semantic-memory"]);

/**
 * Wrap content with provenance metadata.
 *
 * @param content - The raw content string
 * @param source - Where the content came from
 * @param trusted - Override trust level. If omitted, "user" and "memory" are trusted.
 */
export function tagContent(
  content: string,
  source: ProvenanceTag,
  trusted?: boolean,
): TaggedContent {
  return {
    content,
    source,
    trusted: trusted ?? TRUSTED_SOURCES.has(source),
  };
}
