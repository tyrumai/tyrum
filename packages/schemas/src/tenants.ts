import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";

export const TenantStatus = z.enum(["active", "disabled"]);
export type TenantStatus = z.infer<typeof TenantStatus>;

export const Tenant = z
  .object({
    tenant_id: UuidSchema,
    tenant_key: z.string().trim().min(1),
    name: z.string().trim().min(1),
    status: TenantStatus,
    created_at: DateTimeSchema.optional(),
    updated_at: DateTimeSchema.optional(),
  })
  .strict();
export type Tenant = z.infer<typeof Tenant>;

export const TenantListResponse = z
  .object({
    tenants: z.array(Tenant),
  })
  .strict();
export type TenantListResponse = z.infer<typeof TenantListResponse>;

export const TenantCreateRequest = z
  .object({
    tenant_key: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
  })
  .strict();
export type TenantCreateRequest = z.infer<typeof TenantCreateRequest>;

export const TenantCreateResponse = z
  .object({
    tenant: Tenant,
  })
  .strict();
export type TenantCreateResponse = z.infer<typeof TenantCreateResponse>;
