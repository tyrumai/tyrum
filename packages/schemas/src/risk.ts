import { z } from "zod";

export const RiskLevel = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const RiskSpendContext = z.object({
  amount_minor_units: z.number().int().nonnegative(),
  currency: z.string(),
  merchant: z.string().optional(),
});
export type RiskSpendContext = z.infer<typeof RiskSpendContext>;

export const RiskInput = z.object({
  tags: z.array(z.string()).default([]),
  spend: RiskSpendContext.optional(),
});
export type RiskInput = z.infer<typeof RiskInput>;

export const RiskVerdict = z.object({
  level: RiskLevel,
  confidence: z.number(),
  reasons: z.array(z.string()).default([]),
});
export type RiskVerdict = z.infer<typeof RiskVerdict>;

export const SpendThreshold = z.object({
  caution_minor_units: z.number().int().nonnegative(),
  high_minor_units: z.number().int().nonnegative(),
});
export type SpendThreshold = z.infer<typeof SpendThreshold>;

export const RiskConfig = z.object({
  baseline_confidence: z.number().default(0.35),
  tag_medium_threshold: z.number().default(0.3),
  tag_high_threshold: z.number().default(0.6),
  tag_weights: z.record(z.string(), z.number()).default({}),
  spend_thresholds: z.record(z.string(), SpendThreshold).default({}),
});
export type RiskConfig = z.infer<typeof RiskConfig>;
