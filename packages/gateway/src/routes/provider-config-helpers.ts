import type { Context } from "hono";
import { ConfiguredProviderAccount, ModelConfigDeleteConflictResponse } from "@tyrum/contracts";
import type { AuthProfileRow } from "../app/modules/models/auth-profile-dal.js";
import type { ConfiguredModelPresetDal } from "../app/modules/models/configured-model-preset-dal.js";
import type { ExecutionProfileModelAssignmentDal } from "../app/modules/models/execution-profile-model-assignment-dal.js";
import {
  buildManagedProviderSecretKey,
  listProviderRegistrySpecs,
  type ProviderMethodSpec,
  type ProviderRegistrySpec,
} from "../app/modules/models/provider-config-registry.js";
import { normalizePublicExecutionProfileId } from "../app/modules/models/public-execution-profiles.js";
import type { SecretProvider } from "../app/modules/secret/provider.js";
import type { ModelCatalogService } from "../app/modules/models/model-catalog-service.js";

export type ReplacementAssignments = Record<string, string | null>;

export const invalidRequest = (c: Context, message: string) =>
  c.json({ error: "invalid_request", message }, 400);
export const notFound = (c: Context, message: string) =>
  c.json({ error: "not_found", message }, 404);

export function toContractAccount(row: AuthProfileRow) {
  return ConfiguredProviderAccount.parse({
    account_id: row.auth_profile_id,
    account_key: row.auth_profile_key,
    provider_key: row.provider_key,
    display_name: row.display_name,
    method_key: row.method_key,
    type: row.type,
    status: row.status,
    config: row.config,
    configured_secret_keys: Object.keys(row.secret_keys).toSorted((a, b) => a.localeCompare(b)),
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function validateConfigFieldValue(
  value: unknown,
  field: ProviderMethodSpec["fields"][number],
): { ok: true; value: unknown } | { ok: false; message: string } {
  if (field.input === "boolean")
    return typeof value === "boolean"
      ? { ok: true, value }
      : { ok: false, message: `${field.key} must be a boolean` };
  if (typeof value !== "string") return { ok: false, message: `${field.key} must be a string` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, message: `${field.key} must not be empty` };
  return { ok: true, value: trimmed };
}

function validateSecretFieldValue(
  value: unknown,
  field: ProviderMethodSpec["fields"][number],
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== "string") return { ok: false, message: `${field.key} must be a string` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, message: `${field.key} must not be empty` };
  return { ok: true, value: trimmed };
}

export function validateProviderAccountInput(input: {
  method: ProviderMethodSpec;
  config: Record<string, unknown>;
  secretValues: Record<string, unknown>;
  existingSecretKeys?: Record<string, string>;
}):
  | {
      ok: true;
      config: Record<string, unknown>;
      newSecretValues: Record<string, string>;
      configuredSecretKeys: Record<string, string>;
    }
  | { ok: false; message: string } {
  const configFields = new Map(
    input.method.fields
      .filter((field) => field.kind === "config")
      .map((field) => [field.key, field]),
  );
  const secretFields = new Map(
    input.method.fields
      .filter((field) => field.kind === "secret")
      .map((field) => [field.key, field]),
  );

  for (const key of Object.keys(input.config)) {
    if (!configFields.has(key)) {
      return { ok: false, message: `unknown config field '${key}'` };
    }
  }
  for (const key of Object.keys(input.secretValues)) {
    if (!secretFields.has(key)) {
      return { ok: false, message: `unknown secret field '${key}'` };
    }
  }

  const normalizedConfig: Record<string, unknown> = {};
  for (const field of configFields.values()) {
    const raw = input.config[field.key];
    if (raw === undefined) {
      if (field.required) {
        return { ok: false, message: `${field.key} is required` };
      }
      continue;
    }
    const normalized = validateConfigFieldValue(raw, field);
    if (!normalized.ok) return normalized;
    normalizedConfig[field.key] = normalized.value;
  }

  const newSecretValues: Record<string, string> = {};
  const configuredSecretKeys = input.existingSecretKeys ?? {};
  for (const field of secretFields.values()) {
    const raw = input.secretValues[field.key];
    if (raw === undefined) {
      if (field.required && !configuredSecretKeys[field.key]) {
        return { ok: false, message: `${field.key} is required` };
      }
      continue;
    }
    const normalized = validateSecretFieldValue(raw, field);
    if (!normalized.ok) return normalized;
    newSecretValues[field.key] = normalized.value;
  }

  return {
    ok: true,
    config: normalizedConfig,
    newSecretValues,
    configuredSecretKeys,
  };
}

export async function loadRegistrySpecs(
  modelCatalog: ModelCatalogService,
  tenantId: string,
): Promise<Map<string, ProviderRegistrySpec>> {
  const loaded = await modelCatalog.getEffectiveCatalog({ tenantId });
  return new Map(
    listProviderRegistrySpecs(loaded.catalog).map((provider) => [provider.provider_key, provider]),
  );
}

export async function storeManagedSecrets(input: {
  secretProvider: SecretProvider;
  accountKey: string;
  secretValues: Record<string, string>;
}): Promise<Record<string, string>> {
  const configuredSecretKeys: Record<string, string> = {};
  for (const [slotKey, value] of Object.entries(input.secretValues)) {
    const secretKey = buildManagedProviderSecretKey(input.accountKey, slotKey);
    await input.secretProvider.store(secretKey, value);
    configuredSecretKeys[slotKey] = secretKey;
  }
  return configuredSecretKeys;
}

export async function revokeManagedSecrets(
  secretProvider: SecretProvider,
  secretKeys: string[],
): Promise<void> {
  for (const secretKey of secretKeys) await secretProvider.revoke(secretKey).catch(() => false);
}

export async function resolveProviderDeletionRequirements(input: {
  presetDal: ConfiguredModelPresetDal;
  assignmentDal: ExecutionProfileModelAssignmentDal;
  tenantId: string;
  deletedProviderKey: string;
  replacementAssignments?: ReplacementAssignments;
}) {
  const presets = await input.presetDal.list({
    tenantId: input.tenantId,
    providerKey: input.deletedProviderKey,
  });
  const deletedPresetKeys = new Set(presets.map((preset) => preset.preset_key));
  const assignments =
    deletedPresetKeys.size > 0
      ? (await input.assignmentDal.list({ tenantId: input.tenantId })).filter((assignment) =>
          deletedPresetKeys.has(assignment.preset_key),
        )
      : [];

  const requiredExecutionProfileIds = [
    ...new Set(
      assignments.flatMap((assignment) => {
        const profileId = normalizePublicExecutionProfileId(assignment.execution_profile_id);
        return profileId ? [profileId] : [];
      }),
    ),
  ].toSorted((a, b) => a.localeCompare(b));
  if (requiredExecutionProfileIds.length === 0) {
    return {
      deletedPresetKeys,
      replacementAssignments: [] as Array<{ executionProfileId: string; presetKey: string | null }>,
    };
  }

  const replacements = input.replacementAssignments ?? {};
  const missing = requiredExecutionProfileIds.filter((profileId) => !(profileId in replacements));
  if (missing.length > 0) {
    return {
      deletedPresetKeys,
      conflict: ModelConfigDeleteConflictResponse.parse({
        error: "assignment_required",
        message: "replacement preset assignments are required before deleting this provider",
        required_execution_profile_ids: requiredExecutionProfileIds,
      }),
    };
  }

  const allPresets = await input.presetDal.list({ tenantId: input.tenantId });
  const presetsByKey = new Map(allPresets.map((preset) => [preset.preset_key, preset]));
  const replacementAssignmentsResult = requiredExecutionProfileIds.map((executionProfileId) => {
    const presetKey = replacements[executionProfileId];
    if (presetKey === null) {
      return {
        executionProfileId,
        presetKey: null,
      };
    }
    const preset = presetKey ? presetsByKey.get(presetKey) : undefined;
    if (!preset || deletedPresetKeys.has(preset.preset_key)) {
      throw new Error(`replacement preset '${presetKey ?? ""}' is invalid`);
    }
    return {
      executionProfileId,
      presetKey: preset.preset_key,
    };
  });

  return { deletedPresetKeys, replacementAssignments: replacementAssignmentsResult };
}
