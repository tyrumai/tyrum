import { Hono } from "hono";
import {
  ConfiguredProviderListResponse,
  ModelConfigDeleteRequest,
  ModelConfigDeleteResponse,
  ProviderAccountCreateRequest,
  ProviderAccountMutateResponse,
  ProviderAccountUpdateRequest,
  ProviderRegistryResponse,
} from "@tyrum/contracts";
import type { SqlDb } from "../statestore/types.js";
import { requireTenantId } from "../app/modules/auth/claims.js";
import type { ModelCatalogService } from "../app/modules/models/model-catalog-service.js";
import type { AuthProfileDal } from "../app/modules/models/auth-profile-dal.js";
import { ConfiguredModelPresetDal } from "../app/modules/models/configured-model-preset-dal.js";
import { ExecutionProfileModelAssignmentDal } from "../app/modules/models/execution-profile-model-assignment-dal.js";
import {
  buildManagedProviderSecretKey,
  findProviderMethodSpec,
  listProviderRegistrySpecs,
} from "../app/modules/models/provider-config-registry.js";
import type { SecretProvider } from "../app/modules/secret/provider.js";
import { createUniqueKey, slugifyKey } from "./config-key-utils.js";
import { escapeLikePattern } from "../utils/sql-like.js";
import {
  invalidRequest,
  loadRegistrySpecs,
  notFound,
  resolveProviderDeletionRequirements,
  revokeManagedSecrets,
  storeManagedSecrets,
  toContractAccount,
  validateProviderAccountInput,
} from "./provider-config-helpers.js";

export type { ReplacementAssignments } from "./provider-config-helpers.js";

export interface ProviderConfigRouteDeps {
  db: SqlDb;
  authProfileDal: AuthProfileDal;
  modelCatalog: ModelCatalogService;
  secretProviderForTenant: (tenantId: string) => SecretProvider;
  configuredModelPresetDal: ConfiguredModelPresetDal;
  executionProfileModelAssignmentDal: ExecutionProfileModelAssignmentDal;
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
        "DELETE FROM conversation_provider_pins WHERE tenant_id = ? AND auth_profile_id = ?",
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
          await new ExecutionProfileModelAssignmentDal(tx).setManyTx({
            tenantId,
            assignments: resolved.replacementAssignments,
          });
        }
        if (deletedPresetKeys.length > 0) {
          const presetPlaceholders = deletedPresetKeys.map(() => "?").join(", ");
          await tx.run(
            `DELETE FROM conversation_model_overrides WHERE tenant_id = ? AND preset_key IN (${presetPlaceholders})`,
            [tenantId, ...deletedPresetKeys],
          );
          await tx.run(
            "DELETE FROM configured_model_presets WHERE tenant_id = ? AND provider_key = ?",
            [tenantId, providerKey],
          );
        }
        await tx.run(
          "DELETE FROM conversation_model_overrides WHERE tenant_id = ? AND model_id LIKE ? ESCAPE '\\'",
          [tenantId, `${escapeLikePattern(providerKey)}/%`],
        );
        if (profileIds.length > 0) {
          const profilePlaceholders = profileIds.map(() => "?").join(", ");
          await tx.run(
            `DELETE FROM conversation_provider_pins WHERE tenant_id = ? AND auth_profile_id IN (${profilePlaceholders})`,
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
