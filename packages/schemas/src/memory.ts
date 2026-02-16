import { z } from "zod";

export const Fact = z.object({
  id: z.number().int().optional(),
  subject_id: z.string(),
  fact_key: z.string(),
  fact_value: z.unknown(),
  source: z.string(),
  observed_at: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  created_at: z.string().datetime().optional(),
});
export type Fact = z.infer<typeof Fact>;

export const EpisodicEvent = z.object({
  id: z.number().int().optional(),
  subject_id: z.string(),
  event_id: z.string(),
  occurred_at: z.string().datetime(),
  channel: z.string(),
  event_type: z.string(),
  payload: z.unknown(),
  created_at: z.string().datetime().optional(),
});
export type EpisodicEvent = z.infer<typeof EpisodicEvent>;

export const CapabilityMemory = z.object({
  id: z.number().int().optional(),
  subject_id: z.string(),
  capability_key: z.string(),
  capability_value: z.unknown(),
  source: z.string(),
  observed_at: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  metadata: z.unknown().optional(),
  created_at: z.string().datetime().optional(),
});
export type CapabilityMemory = z.infer<typeof CapabilityMemory>;

export const PamProfile = z.object({
  id: z.number().int().optional(),
  subject_id: z.string(),
  profile_id: z.string(),
  version: z.string().optional(),
  profile_data: z.unknown(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});
export type PamProfile = z.infer<typeof PamProfile>;

export const PvpProfile = z.object({
  id: z.number().int().optional(),
  subject_id: z.string(),
  profile_id: z.string(),
  version: z.string().optional(),
  profile_data: z.unknown(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});
export type PvpProfile = z.infer<typeof PvpProfile>;

export const VectorEmbedding = z.object({
  id: z.number().int().optional(),
  subject_id: z.string(),
  embedding_id: z.string(),
  embedding: z.array(z.number()),
  embedding_model: z.string(),
  label: z.string().optional(),
  metadata: z.unknown().optional(),
  created_at: z.string().datetime().optional(),
});
export type VectorEmbedding = z.infer<typeof VectorEmbedding>;
