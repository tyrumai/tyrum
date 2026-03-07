import { Hono, type Context } from "hono";
import {
  ConfiguredProviderAccount,
  ConfiguredProviderListResponse,
  ModelConfigDeleteConflictResponse,
  ModelConfigDeleteRequest,
  ModelConfigDeleteResponse,
  ProviderAccountCreateRequest,
  ProviderAccountMutateResponse,
  ProviderAccountUpdateRequest,
  ProviderRegistryResponse,
} from "@tyrum/schemas";
import type { SqlDb } from "../statestore/types.js";
import { requireTenantId } from "../modules/auth/claims.js";
import type { ModelCatalogService } from "../modules/models/model-catalog-service.js";
import type { AuthProfileDal, AuthProfileRow } from "../modules/models/auth-profile-dal.js";
import { ConfiguredModelPresetDal } from "../modules/models/configured-model-preset-dal.js";
import { ExecutionProfileModelAssignmentDal } from "../modules/models/execution-profile-model-assignment-dal.js";
import {
  buildManagedProviderSecretKey,
  findProviderMethodSpec,
  listProviderRegistrySpecs,
  type ProviderMethodSpec,
  type ProviderRegistrySpec,
} from "../modules/models/provider-config-registry.js";
import type { SecretProvider } from "../modules/secret/provider.js";
import { coerceString } from "../modules/util/coerce.js";
import { createUniqueKey, slugifyKey } from "./config-key-utils.js";
import { escapeLikePattern } from "../utils/sql-like.js";

type ReplacementAssignments = Record<string, string>;

export interface ProviderConfigRouteDeps {
  db: SqlDb;
  authProfileDal: AuthProfileDal;
  modelCatalog: ModelCatalogService;
  secretProviderForTenant: (tenantId: string) => SecretProvider;
  configuredModelPresetDal: ConfiguredModelPresetDal;
  executionProfileModelAssignmentDal: ExecutionProfileModelAssignmentDal;
}

const invalidRequest = (c: Context, message: string) =>
  c.json({ error: "invalid_request", message }, 400);
const notFound = (c: Context, message: string) => c.json({ error: "not_found", message }, 404);

function toContractAccount(row: AuthProfileRow) {
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

function validateProviderAccountInput(input: {
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

async function loadRegistrySpecs(
  modelCatalog: ModelCatalogService,
  tenantId: string,
): Promise<Map<string, ProviderRegistrySpec>> {
  const loaded = await modelCatalog.getEffectiveCatalog({ tenantId });
  return new Map(
    listProviderRegistrySpecs(loaded.catalog).map((provider) => [provider.provider_key, provider]),
  );
}

async function listProviderGroups(deps: ProviderConfigRouteDeps, tenantId: string) {
  const [registrySpecs, rows] = await Promise.all([
    loadRegistrySpecs(deps.modelCatalog, tenantId),
    deps.authProfileDal.list({ tenantId, limit: 500 }),
  ]);

  const grouped = new Map<
    string,
    {
      provider_key: string;
      name: string;
      doc: string | null;
      supported: boolean;
      accounts: ReturnType<typeof toContractAccount>[];
    }
  >();

  for (const row of rows) {
    const registrySpec = registrySpecs.get(row.provider_key);
    const existing = grouped.get(row.provider_key) ?? {
      provider_key: row.provider_key,
      name: registrySpec?.name?.trim() || row.provider_key,
      doc: registrySpec?.doc ?? null,
      supported: registrySpec?.supported ?? false,
      accounts: [],
    };
    existing.accounts.push(toContractAccount(row));
    grouped.set(row.provider_key, existing);
  }

  const providers = Array.from(grouped.values())
    .map((provider) => {
      provider.accounts = provider.accounts.toSorted((a, b) =>
        a.display_name.localeCompare(b.display_name),
      );
      return provider;
    })
    .toSorted(
      (a, b) => a.name.localeCompare(b.name) || a.provider_key.localeCompare(b.provider_key),
    );
  return ConfiguredProviderListResponse.parse({ status: "ok", providers });
}

async function storeManagedSecrets(input: {
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

async function revokeManagedSecrets(
  secretProvider: SecretProvider,
  secretKeys: string[],
): Promise<void> {
  for (const secretKey of secretKeys) await secretProvider.revoke(secretKey).catch(() => false);
}

async function resolveProviderDeletionRequirements(input: {
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

  const requiredExecutionProfileIds = assignments
    .map((assignment) => assignment.execution_profile_id)
    .toSorted((a, b) => a.localeCompare(b));
  if (requiredExecutionProfileIds.length === 0) {
    return {
      deletedPresetKeys,
      replacementAssignments: [] as Array<{ executionProfileId: string; presetKey: string }>,
    };
  }

  const replacements = input.replacementAssignments ?? {};
  const missing = requiredExecutionProfileIds.filter(
    (profileId) => !coerceString(replacements[profileId]),
  );
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
  const replacementAssignments = requiredExecutionProfileIds.map((executionProfileId) => {
    const presetKey = replacements[executionProfileId];
    const preset = presetKey ? presetsByKey.get(presetKey) : undefined;
    if (!preset || deletedPresetKeys.has(preset.preset_key)) {
      throw new Error(`replacement preset '${presetKey ?? ""}' is invalid`);
    }
    return {
      executionProfileId,
      presetKey: preset.preset_key,
    };
  });

  return { deletedPresetKeys, replacementAssignments };
}

export function createProviderConfigRoutes(deps: ProviderConfigRouteDeps): Hono {
  const app = new Hono();

  app.get("/config/providers/registry", async (c) => {
    const tenantId = requireTenantId(c);
    const loaded = await deps.modelCatalog.getEffectiveCatalog({ tenantId });
    const providers = listProviderRegistrySpecs(loaded.catalog);
    return c.json(ProviderRegistryResponse.parse({ status: "ok", providers }));
  });

  app.get("/config/providers", async (c) => {
    const tenantId = requireTenantId(c);
    return c.json(await listProviderGroups(deps, tenantId));
  });

  app.post("/config/providers/accounts", async (c) => {
    const tenantId = requireTenantId(c);
    const body = (await c.req.json().catch(() => undefined)) as unknown;
    const parsed = ProviderAccountCreateRequest.safeParse(body);
    if (!parsed.success) return invalidRequest(c, parsed.error.message);

    const registrySpecs = await loadRegistrySpecs(deps.modelCatalog, tenantId);
    const providerSpec = registrySpecs.get(parsed.data.provider_key);
    const method = findProviderMethodSpec(providerSpec, parsed.data.method_key);
    if (!providerSpec || !providerSpec.supported || !method)
      return invalidRequest(c, "provider or authentication method is not supported");

    const validated = validateProviderAccountInput({
      method,
      config: parsed.data.config,
      secretValues: parsed.data.secrets,
    });
    if (!validated.ok) return invalidRequest(c, validated.message);

    const existingRows = await deps.authProfileDal.list({
      tenantId,
      providerKey: parsed.data.provider_key,
      limit: 500,
    });
    const accountKey = createUniqueKey(
      `${parsed.data.provider_key}-${slugifyKey(parsed.data.display_name, "account")}`,
      new Set(existingRows.map((row) => row.auth_profile_key)),
    );

    const secretProvider = deps.secretProviderForTenant(tenantId);
    let managedSecretKeys: Record<string, string> = {};
    try {
      managedSecretKeys = await storeManagedSecrets({
        secretProvider,
        accountKey,
        secretValues: validated.newSecretValues,
      });
      const row = await deps.authProfileDal.create({
        tenantId,
        authProfileKey: accountKey,
        providerKey: parsed.data.provider_key,
        displayName: parsed.data.display_name,
        methodKey: method.method_key,
        type: method.type,
        config: validated.config,
        secretKeys: managedSecretKeys,
      });

      return c.json(
        ProviderAccountMutateResponse.parse({ status: "ok", account: toContractAccount(row) }),
        201,
      );
    } catch (error) {
      await revokeManagedSecrets(secretProvider, Object.values(managedSecretKeys));
      throw error;
    }
  });

  app.patch("/config/providers/accounts/:key", async (c) => {
    const tenantId = requireTenantId(c);
    const accountKey = c.req.param("key");
    const body = (await c.req.json().catch(() => undefined)) as unknown;
    const parsed = ProviderAccountUpdateRequest.safeParse(body);
    if (!parsed.success) return invalidRequest(c, parsed.error.message);

    const existing = await deps.authProfileDal.getByKey({
      tenantId,
      authProfileKey: accountKey,
    });
    if (!existing) return notFound(c, "provider account not found");

    const registrySpecs = await loadRegistrySpecs(deps.modelCatalog, tenantId);
    const providerSpec = registrySpecs.get(existing.provider_key);
    const method = findProviderMethodSpec(providerSpec, existing.method_key);
    if (!method) return invalidRequest(c, "provider account is using an unsupported method");

    const validated = validateProviderAccountInput({
      method,
      config:
        parsed.data.config === undefined
          ? existing.config
          : { ...existing.config, ...parsed.data.config },
      secretValues: parsed.data.secrets ?? {},
      existingSecretKeys: existing.secret_keys,
    });
    if (!validated.ok) return invalidRequest(c, validated.message);

    const secretProvider = deps.secretProviderForTenant(tenantId);
    const updatedSecretKeys = {
      ...existing.secret_keys,
    };
    for (const [slotKey, value] of Object.entries(validated.newSecretValues)) {
      const secretKey = buildManagedProviderSecretKey(accountKey, slotKey);
      await secretProvider.store(secretKey, value);
      updatedSecretKeys[slotKey] = secretKey;
    }

    let row = await deps.authProfileDal.updateByKey({
      tenantId,
      authProfileKey: accountKey,
      displayName: parsed.data.display_name,
      config: parsed.data.config === undefined ? undefined : validated.config,
      secretKeys:
        parsed.data.secrets === undefined
          ? undefined
          : method.fields
              .filter((field) => field.kind === "secret")
              .reduce<Record<string, string>>((acc, field) => {
                const secretKey = updatedSecretKeys[field.key];
                if (secretKey) {
                  acc[field.key] = secretKey;
                }
                return acc;
              }, {}),
    });
    if (!row) return notFound(c, "provider account not found");

    if (parsed.data.status && parsed.data.status !== existing.status) {
      row =
        parsed.data.status === "disabled"
          ? await deps.authProfileDal.disableByKey({ tenantId, authProfileKey: accountKey })
          : await deps.authProfileDal.enableByKey({ tenantId, authProfileKey: accountKey });
      if (!row) return notFound(c, "provider account not found");
    }
    return c.json(
      ProviderAccountMutateResponse.parse({ status: "ok", account: toContractAccount(row) }),
    );
  });

  app.delete("/config/providers/accounts/:key", async (c) => {
    const tenantId = requireTenantId(c);
    const accountKey = c.req.param("key");
    const existing = await deps.authProfileDal.getByKey({
      tenantId,
      authProfileKey: accountKey,
    });
    if (!existing) return notFound(c, "provider account not found");

    const providerAccounts = await deps.authProfileDal.list({
      tenantId,
      providerKey: existing.provider_key,
      limit: 2,
    });
    if (providerAccounts.length === 1) {
      const resolved = await resolveProviderDeletionRequirements({
        presetDal: deps.configuredModelPresetDal,
        assignmentDal: deps.executionProfileModelAssignmentDal,
        tenantId,
        deletedProviderKey: existing.provider_key,
      });
      if ("conflict" in resolved) {
        return c.json(
          {
            ...resolved.conflict,
            message:
              "cannot delete the last provider account while configured model presets or execution-profile assignments still reference this provider; delete the provider instead",
          },
          409,
        );
      }
      if (resolved.deletedPresetKeys.size > 0) {
        return c.json(
          {
            error: "invalid_request",
            message:
              "cannot delete the last provider account while configured model presets still reference this provider; delete the provider instead",
          },
          409,
        );
      }
    }

    await deps.db.transaction(async (tx) => {
      await tx.run(
        "DELETE FROM session_provider_pins WHERE tenant_id = ? AND auth_profile_id = ?",
        [tenantId, existing.auth_profile_id],
      );
      await tx.run("DELETE FROM auth_profiles WHERE tenant_id = ? AND auth_profile_key = ?", [
        tenantId,
        existing.auth_profile_key,
      ]);
    });

    await revokeManagedSecrets(
      deps.secretProviderForTenant(tenantId),
      Object.values(existing.secret_keys),
    );
    return c.json(ModelConfigDeleteResponse.parse({ status: "ok" }));
  });

  app.delete("/config/providers/:provider", async (c) => {
    const tenantId = requireTenantId(c);
    const providerKey = c.req.param("provider");
    const accounts = await deps.authProfileDal.list({
      tenantId,
      providerKey,
      limit: 500,
    });
    if (accounts.length === 0) return notFound(c, "provider not found");

    const body = (await c.req.json().catch(() => undefined)) as unknown;
    const parsed = ModelConfigDeleteRequest.safeParse(body ?? {});
    if (!parsed.success) return invalidRequest(c, parsed.error.message);

    try {
      const resolved = await resolveProviderDeletionRequirements({
        presetDal: deps.configuredModelPresetDal,
        assignmentDal: deps.executionProfileModelAssignmentDal,
        tenantId,
        deletedProviderKey: providerKey,
        replacementAssignments: parsed.data.replacement_assignments,
      });
      if ("conflict" in resolved) return c.json(resolved.conflict, 409);

      const deletedPresetKeys = Array.from(resolved.deletedPresetKeys);
      const profileIds = accounts.map((row) => row.auth_profile_id);
      const secretKeys = Array.from(
        new Set(accounts.flatMap((row) => Object.values(row.secret_keys))),
      );

      await deps.db.transaction(async (tx) => {
        if (resolved.replacementAssignments.length > 0) {
          await new ExecutionProfileModelAssignmentDal(tx).upsertManyTx({
            tenantId,
            assignments: resolved.replacementAssignments,
          });
        }
        if (deletedPresetKeys.length > 0) {
          const presetPlaceholders = deletedPresetKeys.map(() => "?").join(", ");
          await tx.run(
            `DELETE FROM session_model_overrides WHERE tenant_id = ? AND preset_key IN (${presetPlaceholders})`,
            [tenantId, ...deletedPresetKeys],
          );
          await tx.run(
            "DELETE FROM configured_model_presets WHERE tenant_id = ? AND provider_key = ?",
            [tenantId, providerKey],
          );
        }
        await tx.run(
          "DELETE FROM session_model_overrides WHERE tenant_id = ? AND model_id LIKE ? ESCAPE '\\'",
          [tenantId, `${escapeLikePattern(providerKey)}/%`],
        );
        if (profileIds.length > 0) {
          const profilePlaceholders = profileIds.map(() => "?").join(", ");
          await tx.run(
            `DELETE FROM session_provider_pins WHERE tenant_id = ? AND auth_profile_id IN (${profilePlaceholders})`,
            [tenantId, ...profileIds],
          );
        }
        await tx.run("DELETE FROM auth_profiles WHERE tenant_id = ? AND provider_key = ?", [
          tenantId,
          providerKey,
        ]);
      });

      await revokeManagedSecrets(deps.secretProviderForTenant(tenantId), secretKeys);
      return c.json(ModelConfigDeleteResponse.parse({ status: "ok" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid replacement preset";
      return invalidRequest(c, message);
    }
  });

  return app;
}
