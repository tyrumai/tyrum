import { z } from "zod";

/**
 * Provenance tags for content entering Tyrum.
 *
 * Used for injection defense and provenance-aware policy rules.
 */
export const ProvenanceTag = z.enum([
  "user",
  "connector",
  "tool",
  "web",
  "email",
  "system",
  "memory",
  "semantic-memory",
]);
export type ProvenanceTag = z.infer<typeof ProvenanceTag>;

