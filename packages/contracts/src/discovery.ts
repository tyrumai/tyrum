import { z } from "zod";

export const DiscoveryStrategy = z.enum(["mcp", "structured_api", "generic_http"]);
export type DiscoveryStrategy = z.infer<typeof DiscoveryStrategy>;

export const DiscoveryRequest = z.object({
  query: z.string(),
  target_url: z.string().url().optional(),
  preferred_strategy: DiscoveryStrategy.optional(),
  max_results: z.number().int().positive().default(5),
});
export type DiscoveryRequest = z.infer<typeof DiscoveryRequest>;

export const DiscoveryResolution = z.object({
  strategy: DiscoveryStrategy,
  connector_url: z.string().url(),
  label: z.string().optional(),
  rank: z.number().int().nonnegative(),
  metadata: z.unknown().optional(),
});
export type DiscoveryResolution = z.infer<typeof DiscoveryResolution>;

export const DiscoveryOutcome = z.object({
  resolutions: z.array(DiscoveryResolution),
  cached: z.boolean().default(false),
});
export type DiscoveryOutcome = z.infer<typeof DiscoveryOutcome>;
