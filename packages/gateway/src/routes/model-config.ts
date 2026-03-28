import { Hono } from "hono";
import {
  ConfiguredAvailableModelListResponse,
  ConfiguredModelPreset,
  ConfiguredModelPresetCreateRequest,
  ConfiguredModelPresetListResponse,
  ConfiguredModelPresetMutateResponse,
  ConfiguredModelPresetUpdateRequest,
  ExecutionProfileModelAssignmentListResponse,
  ExecutionProfileModelAssignmentUpdateRequest,
  ExecutionProfileModelAssignmentUpdateResponse,
  ModelConfigDeleteConflictResponse,
  ModelConfigDeleteRequest,
  ModelConfigDeleteResponse,
} from "@tyrum/contracts";
import type { SqlDb } from "../statestore/types.js";
import { requireTenantId } from "../app/modules/auth/claims.js";
import type { ModelCatalogService } from "../app/modules/models/model-catalog-service.js";
import type { AuthProfileDal } from "../app/modules/models/auth-profile-dal.js";
import {
  ConfiguredModelPresetDal,
  type ConfiguredModelPresetRow,
} from "../app/modules/models/configured-model-preset-dal.js";
import {
  ExecutionProfileModelAssignmentDal,
  type ExecutionProfileModelAssignmentRow,
} from "../app/modules/models/execution-profile-model-assignment-dal.js";
import {
  normalizePublicExecutionProfileId,
  PUBLIC_EXECUTION_PROFILE_IDS,
} from "../app/modules/models/public-execution-profiles.js";
import { normalizeProviderScopedModelId } from "../app/modules/models/provider-model-id.js";
import { coerceRecord } from "../app/modules/util/coerce.js";
import { createUniqueKey, slugifyKey } from "./config-key-utils.js";

const EXECUTION_PROFILE_IDS = PUBLIC_EXECUTION_PROFILE_IDS;

type ReplacementAssignments = Record<string, string | null>;

export interface ModelConfigRouteDeps {
  db: SqlDb;
  modelCatalog: ModelCatalogService;
  authProfileDal: AuthProfileDal;
  configuredModelPresetDal: ConfiguredModelPresetDal;
  executionProfileModelAssignmentDal: ExecutionProfileModelAssignmentDal;
}

type CatalogModelRecord = {
  id: string;
  name: string;
  family?: string | null;
  reasoning?: boolean | null;
  tool_call?: boolean | null;
  modalities?: unknown;
};

type CatalogProviderRecord = {
  id: string;
  name: string;
  models?: Record<string, CatalogModelRecord>;
};

function isLanguageModel(model: Record<string, unknown>): boolean {
  const modalities = coerceRecord(model["modalities"]);
  const output = Array.isArray(modalities?.["output"]) ? modalities?.["output"] : undefined;
  if (!output) return true;
  return output.includes("text");
}

function toContractPreset(row: ConfiguredModelPresetRow) {
  return ConfiguredModelPreset.parse({
    preset_id: row.preset_id,
    preset_key: row.preset_key,
    display_name: row.display_name,
    provider_key: row.provider_key,
    model_id: row.model_id,
    options: row.options,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

async function loadConfiguredProviderKeys(
  authProfileDal: AuthProfileDal,
  tenantId: string,
): Promise<Set<string>> {
  const profiles = await authProfileDal.list({ tenantId, limit: 500 });
  return new Set(profiles.map((profile) => profile.provider_key));
}

async function loadPresetByKey(
  presetDal: ConfiguredModelPresetDal,
  tenantId: string,
): Promise<Map<string, ConfiguredModelPresetRow>> {
  const presets = await presetDal.list({ tenantId });
  return new Map(presets.map((preset) => [preset.preset_key, preset]));
}

async function toAssignmentResponse(input: {
  assignmentDal: ExecutionProfileModelAssignmentDal;
  presetDal: ConfiguredModelPresetDal;
  tenantId: string;
}) {
  const [assignments, presetsByKey] = await Promise.all([
    input.assignmentDal.list({ tenantId: input.tenantId }),
    loadPresetByKey(input.presetDal, input.tenantId),
  ]);
  const assignmentsByProfileId = new Map<string, ExecutionProfileModelAssignmentRow>();
  for (const assignment of assignments) {
    const profileId = normalizePublicExecutionProfileId(assignment.execution_profile_id);
    if (!profileId) {
      continue;
    }
    if (assignment.execution_profile_id === profileId || !assignmentsByProfileId.has(profileId)) {
      assignmentsByProfileId.set(profileId, assignment);
    }
  }

  return ExecutionProfileModelAssignmentListResponse.parse({
    status: "ok",
    assignments: EXECUTION_PROFILE_IDS.map((executionProfileId) => {
      const assignment = assignmentsByProfileId.get(executionProfileId);
      const preset = assignment ? presetsByKey.get(assignment.preset_key) : undefined;
      return {
        execution_profile_id: executionProfileId,
        preset_key: preset?.preset_key ?? null,
        preset_display_name: preset?.display_name ?? null,
        provider_key: preset?.provider_key ?? null,
        model_id: preset?.model_id ?? null,
      };
    }),
  });
}

function resolveRequiredAssignments(
  assignments: ExecutionProfileModelAssignmentRow[],
  deletedPresetKeys: Set<string>,
) {
  const required = new Set<string>();
  for (const assignment of assignments) {
    if (!deletedPresetKeys.has(assignment.preset_key)) {
      continue;
    }
    const profileId = normalizePublicExecutionProfileId(assignment.execution_profile_id);
    if (profileId) {
      required.add(profileId);
    }
  }
  return [...required].toSorted((a, b) => a.localeCompare(b));
}

async function validateReplacementAssignments(input: {
  presetDal: ConfiguredModelPresetDal;
  tenantId: string;
  deletedPresetKeys: Set<string>;
  requiredExecutionProfileIds: string[];
  replacementAssignments?: ReplacementAssignments;
}) {
  const replacements = input.replacementAssignments ?? {};
  const missing = input.requiredExecutionProfileIds.filter(
    (profileId) => !(profileId in replacements),
  );
  if (missing.length > 0) {
    return {
      conflict: ModelConfigDeleteConflictResponse.parse({
        error: "assignment_required",
        message: "replacement preset assignments are required before deleting this preset",
        required_execution_profile_ids: input.requiredExecutionProfileIds,
      }),
    } as const;
  }

  const presetsByKey = await loadPresetByKey(input.presetDal, input.tenantId);
  const assignments = input.requiredExecutionProfileIds.map((executionProfileId) => {
    const presetKey = replacements[executionProfileId];
    if (presetKey === null) {
      return {
        executionProfileId,
        presetKey: null,
      };
    }
    const preset = presetKey ? presetsByKey.get(presetKey) : undefined;
    if (!preset || input.deletedPresetKeys.has(preset.preset_key)) {
      throw new Error(`replacement preset '${presetKey ?? ""}' is invalid`);
    }
    return {
      executionProfileId,
      presetKey: preset.preset_key,
    };
  });

  return { assignments } as const;
}

export function createModelConfigRoutes(deps: ModelConfigRouteDeps): Hono {
  const app = new Hono();

  app.get("/config/models/presets", async (c) => {
    const tenantId = requireTenantId(c);
    const presets = await deps.configuredModelPresetDal.list({ tenantId });
    return c.json(
      ConfiguredModelPresetListResponse.parse({
        status: "ok",
        presets: presets.map(toContractPreset),
      }),
    );
  });

  app.get("/config/models/presets/available", async (c) => {
    const tenantId = requireTenantId(c);
    const [configuredProviderKeys, loaded] = await Promise.all([
      loadConfiguredProviderKeys(deps.authProfileDal, tenantId),
      deps.modelCatalog.getEffectiveCatalog({ tenantId }),
    ]);
    const catalog = loaded.catalog as Record<string, CatalogProviderRecord>;

    const models = Object.values(catalog)
      .flatMap((provider) => {
        if (!configuredProviderKeys.has(provider.id)) return [];
        return Object.values(provider.models ?? {})
          .filter((model) => isLanguageModel(model as Record<string, unknown>))
          .map((model) => ({
            provider_key: provider.id,
            provider_name: provider.name,
            model_id: normalizeProviderScopedModelId(provider.id, model.id),
            model_name: model.name,
            family: model.family ?? null,
            reasoning: typeof model.reasoning === "boolean" ? model.reasoning : null,
            tool_call: typeof model.tool_call === "boolean" ? model.tool_call : null,
            modalities:
              model.modalities && typeof model.modalities === "object" ? model.modalities : null,
          }));
      })
      .toSorted(
        (a, b) =>
          a.provider_name.localeCompare(b.provider_name) ||
          a.model_name.localeCompare(b.model_name),
      );

    return c.json(
      ConfiguredAvailableModelListResponse.parse({
        status: "ok",
        models,
      }),
    );
  });

  app.post("/config/models/presets", async (c) => {
    const tenantId = requireTenantId(c);
    const body = (await c.req.json().catch(() => undefined)) as unknown;
    const parsed = ConfiguredModelPresetCreateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const [configuredProviderKeys, loaded, existingPresets] = await Promise.all([
      loadConfiguredProviderKeys(deps.authProfileDal, tenantId),
      deps.modelCatalog.getEffectiveCatalog({ tenantId }),
      deps.configuredModelPresetDal.list({ tenantId }),
    ]);
    if (!configuredProviderKeys.has(parsed.data.provider_key)) {
      return c.json({ error: "invalid_request", message: "provider is not configured" }, 400);
    }

    const normalizedModelId = normalizeProviderScopedModelId(
      parsed.data.provider_key,
      parsed.data.model_id,
    );
    const provider = loaded.catalog[parsed.data.provider_key];
    const model = provider?.models?.[normalizedModelId] ?? provider?.models?.[parsed.data.model_id];
    if (!provider || !model || !isLanguageModel(model as Record<string, unknown>)) {
      return c.json({ error: "invalid_request", message: "model is not available" }, 400);
    }

    const presetKey = createUniqueKey(
      slugifyKey(parsed.data.display_name, "model"),
      new Set(existingPresets.map((preset) => preset.preset_key)),
    );
    const row = await deps.configuredModelPresetDal.create({
      tenantId,
      presetKey,
      displayName: parsed.data.display_name,
      providerKey: parsed.data.provider_key,
      modelId: normalizedModelId,
      options: parsed.data.options,
    });

    return c.json(
      ConfiguredModelPresetMutateResponse.parse({
        status: "ok",
        preset: toContractPreset(row),
      }),
      201,
    );
  });

  app.patch("/config/models/presets/:key", async (c) => {
    const tenantId = requireTenantId(c);
    const presetKey = c.req.param("key");
    const body = (await c.req.json().catch(() => undefined)) as unknown;
    const parsed = ConfiguredModelPresetUpdateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const updated = await deps.configuredModelPresetDal.updateByKey({
      tenantId,
      presetKey,
      displayName: parsed.data.display_name,
      options: parsed.data.options,
    });
    if (!updated) {
      return c.json({ error: "not_found", message: "model preset not found" }, 404);
    }

    return c.json(
      ConfiguredModelPresetMutateResponse.parse({
        status: "ok",
        preset: toContractPreset(updated),
      }),
    );
  });

  app.delete("/config/models/presets/:key", async (c) => {
    const tenantId = requireTenantId(c);
    const presetKey = c.req.param("key");
    const existing = await deps.configuredModelPresetDal.getByKey({
      tenantId,
      presetKey,
    });
    if (!existing) {
      return c.json({ error: "not_found", message: "model preset not found" }, 404);
    }

    const body = (await c.req.json().catch(() => undefined)) as unknown;
    const parsed = ModelConfigDeleteRequest.safeParse(body ?? {});
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const deletedPresetKeys = new Set([presetKey]);
    const assignments = await deps.executionProfileModelAssignmentDal.list({ tenantId });
    const requiredExecutionProfileIds = resolveRequiredAssignments(assignments, deletedPresetKeys);
    if (requiredExecutionProfileIds.length > 0) {
      try {
        const replacementAssignments = await validateReplacementAssignments({
          presetDal: deps.configuredModelPresetDal,
          tenantId,
          deletedPresetKeys,
          requiredExecutionProfileIds,
          replacementAssignments: parsed.data.replacement_assignments,
        });
        if ("conflict" in replacementAssignments) {
          return c.json(replacementAssignments.conflict, 409);
        }

        await deps.db.transaction(async (tx) => {
          await new ExecutionProfileModelAssignmentDal(tx).setManyTx({
            tenantId,
            assignments: replacementAssignments.assignments,
          });
          await tx.run(
            `DELETE FROM conversation_model_overrides
             WHERE tenant_id = ? AND preset_key = ?`,
            [tenantId, presetKey],
          );
          await tx.run(
            `DELETE FROM configured_model_presets
             WHERE tenant_id = ? AND preset_key = ?`,
            [tenantId, presetKey],
          );
        });
        return c.json(ModelConfigDeleteResponse.parse({ status: "ok" }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid replacement preset";
        return c.json({ error: "invalid_request", message }, 400);
      }
    }

    await deps.db.transaction(async (tx) => {
      await tx.run(
        `DELETE FROM conversation_model_overrides
         WHERE tenant_id = ? AND preset_key = ?`,
        [tenantId, presetKey],
      );
      await tx.run(
        `DELETE FROM configured_model_presets
         WHERE tenant_id = ? AND preset_key = ?`,
        [tenantId, presetKey],
      );
    });
    return c.json(ModelConfigDeleteResponse.parse({ status: "ok" }));
  });

  app.get("/config/models/assignments", async (c) => {
    const tenantId = requireTenantId(c);
    return c.json(
      await toAssignmentResponse({
        assignmentDal: deps.executionProfileModelAssignmentDal,
        presetDal: deps.configuredModelPresetDal,
        tenantId,
      }),
    );
  });

  app.put("/config/models/assignments", async (c) => {
    const tenantId = requireTenantId(c);
    const body = (await c.req.json().catch(() => undefined)) as unknown;
    const parsed = ExecutionProfileModelAssignmentUpdateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const assignmentRecord = parsed.data.assignments;
    const keys = Object.keys(assignmentRecord).toSorted((a, b) => a.localeCompare(b));
    const expected = [...EXECUTION_PROFILE_IDS].toSorted((a, b) => a.localeCompare(b));
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      return c.json(
        { error: "invalid_request", message: "assignments must include every execution profile" },
        400,
      );
    }

    const presetsByKey = await loadPresetByKey(deps.configuredModelPresetDal, tenantId);
    const assignments = [];
    for (const executionProfileId of EXECUTION_PROFILE_IDS) {
      const presetKey = assignmentRecord[executionProfileId];
      if (presetKey === null) {
        assignments.push({
          executionProfileId,
          presetKey: null,
        });
        continue;
      }
      const preset = presetKey ? presetsByKey.get(presetKey) : undefined;
      if (!preset) {
        return c.json(
          { error: "invalid_request", message: `preset '${presetKey}' not found` },
          400,
        );
      }
      assignments.push({
        executionProfileId,
        presetKey: preset.preset_key,
      });
    }

    try {
      await deps.executionProfileModelAssignmentDal.setMany({
        tenantId,
        assignments,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid assignments";
      return c.json({ error: "invalid_request", message }, 400);
    }

    return c.json(
      ExecutionProfileModelAssignmentUpdateResponse.parse(
        await toAssignmentResponse({
          assignmentDal: deps.executionProfileModelAssignmentDal,
          presetDal: deps.configuredModelPresetDal,
          tenantId,
        }),
      ),
    );
  });

  return app;
}
