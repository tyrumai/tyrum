import { z } from "zod";
import { DateTimeSchema } from "./common.js";
import { PolicyBundle } from "./policy-bundle.js";

export const DeploymentPolicyConfigRevisionNumber = z.number().int().positive();
export type DeploymentPolicyConfigRevisionNumber = z.infer<
  typeof DeploymentPolicyConfigRevisionNumber
>;

export const DeploymentPolicyConfigRevision = z
  .object({
    revision: DeploymentPolicyConfigRevisionNumber,
    agent_key: z.string().trim().min(1).nullable(),
    created_at: DateTimeSchema,
    created_by: z.unknown().nullable(),
    reason: z.string().trim().min(1).nullable(),
    reverted_from_revision: DeploymentPolicyConfigRevisionNumber.nullable(),
  })
  .strict();
export type DeploymentPolicyConfigRevision = z.infer<typeof DeploymentPolicyConfigRevision>;

export const DeploymentPolicyConfigGetResponse = DeploymentPolicyConfigRevision.extend({
  bundle: PolicyBundle,
}).strict();
export type DeploymentPolicyConfigGetResponse = z.infer<typeof DeploymentPolicyConfigGetResponse>;

export const DeploymentPolicyConfigListRevisionsResponse = z
  .object({
    revisions: z.array(DeploymentPolicyConfigRevision),
  })
  .strict();
export type DeploymentPolicyConfigListRevisionsResponse = z.infer<
  typeof DeploymentPolicyConfigListRevisionsResponse
>;

export const DeploymentPolicyConfigUpdateRequest = z
  .object({
    bundle: PolicyBundle,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type DeploymentPolicyConfigUpdateRequest = z.infer<
  typeof DeploymentPolicyConfigUpdateRequest
>;

export const DeploymentPolicyConfigUpdateResponse = DeploymentPolicyConfigGetResponse;
export type DeploymentPolicyConfigUpdateResponse = z.infer<
  typeof DeploymentPolicyConfigUpdateResponse
>;

export const DeploymentPolicyConfigRevertRequest = z
  .object({
    revision: DeploymentPolicyConfigRevisionNumber,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type DeploymentPolicyConfigRevertRequest = z.infer<
  typeof DeploymentPolicyConfigRevertRequest
>;

export const DeploymentPolicyConfigRevertResponse = DeploymentPolicyConfigGetResponse;
export type DeploymentPolicyConfigRevertResponse = z.infer<
  typeof DeploymentPolicyConfigRevertResponse
>;
