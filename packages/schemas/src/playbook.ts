import { z } from "zod";
import { ActionPrimitiveKind } from "./planner.js";

/** A single step within a playbook. */
export const PlaybookStep = z.object({
  name: z.string(),
  action: ActionPrimitiveKind,
  args: z.record(z.string(), z.unknown()).default({}),
  postcondition: z.string().optional(),
  rollback_hint: z.string().optional(),
});
export type PlaybookStep = z.infer<typeof PlaybookStep>;

/** Top-level playbook manifest parsed from YAML. */
export const PlaybookManifest = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  version: z.string(),
  steps: z.array(PlaybookStep).min(1),
  allowed_domains: z.array(z.string()).optional(),
  consent_boundary: z.string().optional(),
});
export type PlaybookManifest = z.infer<typeof PlaybookManifest>;

/** A loaded playbook with filesystem metadata. */
export const Playbook = z.object({
  manifest: PlaybookManifest,
  file_path: z.string(),
  loaded_at: z.string(),
});
export type Playbook = z.infer<typeof Playbook>;
