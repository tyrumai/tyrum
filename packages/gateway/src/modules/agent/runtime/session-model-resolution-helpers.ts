import type { LanguageModel } from "ai";
import type { AgentConfig as AgentConfigT } from "@tyrum/schemas";
import type { GatewayContainer } from "../../../container.js";
import { ConfiguredModelPresetDal } from "../../models/configured-model-preset-dal.js";
import { ExecutionProfileModelAssignmentDal } from "../../models/execution-profile-model-assignment-dal.js";
import { SessionModelOverrideDal } from "../../models/session-model-override-dal.js";
import type { SecretProvider } from "../../secret/provider.js";
import { parseProviderModelId } from "./provider-resolution.js";

export interface ResolveSessionModelDeps {
  container: GatewayContainer;
  languageModelOverride?: LanguageModel;
  secretProvider: SecretProvider | undefined;
  oauthLeaseOwner: string;
  fetchImpl: typeof fetch;
}

const V2_PROVIDER_NPMS = new Set([
  "@gitlab/gitlab-ai-provider",
  "@jerome-benoit/sap-ai-provider-v2",
  "venice-ai-sdk-provider",
]);

export function expectedSpecificationVersionForNpm(npm: string): "v2" | "v3" {
  return V2_PROVIDER_NPMS.has(npm) ? "v2" : "v3";
}

export type CandidateInput = { rawModelId: string; optionsOverride?: Record<string, unknown> };

type ProviderEntry = Awaited<
  ReturnType<GatewayContainer["modelCatalog"]["getEffectiveCatalog"]>
>["catalog"][string];
type ModelEntry = NonNullable<ProviderEntry["models"]>[string];

export type ResolvedCandidate = {
  providerId: string;
  modelId: string;
  provider: ProviderEntry;
  model: ModelEntry;
  npm: string;
  api: string | undefined;
  optionsOverride?: Record<string, unknown>;
};

export async function resolveCandidates(
  deps: ResolveSessionModelDeps,
  input: {
    config: AgentConfigT;
    tenantId: string;
    sessionId: string;
    executionProfileId?: string;
    profileModelId?: string | null;
  },
): Promise<{
  resolvedCandidates: ResolvedCandidate[];
  rawCandidateIds: string[];
}> {
  const override = await new SessionModelOverrideDal(deps.container.db).get({
    tenantId: input.tenantId,
    sessionId: input.sessionId,
  });
  const overrideModelId = override?.model_id?.trim();
  const presetDal = new ConfiguredModelPresetDal(deps.container.db);
  const assignmentDal = new ExecutionProfileModelAssignmentDal(deps.container.db);
  const executionProfileId = input.executionProfileId;
  const sessionPreset =
    override?.preset_key != null
      ? await presetDal.getByKey({
          tenantId: input.tenantId,
          presetKey: override.preset_key,
        })
      : undefined;
  const assignedPreset =
    sessionPreset || !executionProfileId
      ? undefined
      : await (async () => {
          const assignment = await assignmentDal.getByProfileId({
            tenantId: input.tenantId,
            executionProfileId,
          });
          if (!assignment) return undefined;
          return await presetDal.getByKey({
            tenantId: input.tenantId,
            presetKey: assignment.preset_key,
          });
        })();

  const candidateInputs: CandidateInput[] = (() => {
    const baseCandidates = [
      input.profileModelId,
      input.config.model.model,
      ...(input.config.model.fallback ?? []),
    ]
      .filter((value): value is string => typeof value === "string")
      .map((rawModelId) => ({ rawModelId }));
    const presetCandidate = (
      preset: NonNullable<typeof sessionPreset> | NonNullable<typeof assignedPreset>,
    ): CandidateInput => ({
      rawModelId: `${preset.provider_key}/${preset.model_id}`,
      optionsOverride: preset.options,
    });

    if (sessionPreset) return [presetCandidate(sessionPreset), ...baseCandidates];
    if (overrideModelId) return [{ rawModelId: overrideModelId }, ...baseCandidates];
    return assignedPreset ? [presetCandidate(assignedPreset), ...baseCandidates] : baseCandidates;
  })();

  const rawCandidateIds = candidateInputs
    .map((candidate) => candidate.rawModelId.trim())
    .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);

  const catalog = (
    await deps.container.modelCatalog.getEffectiveCatalog({ tenantId: input.tenantId })
  ).catalog;

  const invalidCandidateIds: string[] = [];
  const optionsByCandidateId = new Map<string, Record<string, unknown>>();
  const parsedCandidates: Array<{ providerId: string; modelId: string }> = [];
  const seenCandidates = new Set<string>();
  for (const candidateInput of candidateInputs) {
    const rawCandidate = candidateInput.rawModelId.trim();
    if (!rawCandidate) continue;
    let parsed: { providerId: string; modelId: string } | undefined;
    try {
      parsed = parseProviderModelId(rawCandidate);
    } catch {
      // Intentional: parse failures mark candidate model IDs invalid; surfaced via the thrown error
      // listing candidates below.
      parsed = undefined;
    }

    if (!parsed) {
      invalidCandidateIds.push(rawCandidate);
      continue;
    }

    const key = `${parsed.providerId}/${parsed.modelId}`;
    if (seenCandidates.has(key)) continue;
    seenCandidates.add(key);
    if (candidateInput.optionsOverride) {
      optionsByCandidateId.set(key, candidateInput.optionsOverride);
    }
    parsedCandidates.push(parsed);
  }

  if (invalidCandidateIds.length > 0)
    throw new Error(
      `invalid agent model id(s) (expected provider/model): ${invalidCandidateIds.join(", ")}`,
    );

  if (rawCandidateIds.length === 0) {
    if (executionProfileId) {
      throw new Error(`no model configured for execution profile '${executionProfileId}'`);
    }
    throw new Error("no model configured for this agent");
  }

  const resolvedCandidates: ResolvedCandidate[] = parsedCandidates
    .map((candidate): ResolvedCandidate | undefined => {
      const { providerId, modelId } = candidate;
      const provider = catalog[providerId];
      const model = provider?.models?.[modelId];
      if (!provider || !model) return undefined;
      if (!((provider as { enabled?: boolean }).enabled ?? true)) return undefined;
      if (!((model as { enabled?: boolean }).enabled ?? true)) return undefined;
      const providerOverride = (model as { provider?: { npm?: string; api?: string } }).provider;
      const npm = providerOverride?.npm ?? provider.npm;
      const api = providerOverride?.api ?? provider.api;
      if (!npm) return undefined;

      return {
        providerId,
        modelId,
        provider,
        model,
        npm,
        api,
        optionsOverride: optionsByCandidateId.get(`${providerId}/${modelId}`),
      };
    })
    .filter((v): v is ResolvedCandidate => Boolean(v));

  if (resolvedCandidates.length === 0) {
    const attempted = parsedCandidates.map((c) => `${c.providerId}/${c.modelId}`);
    const attemptedLabel =
      attempted.length > 0 ? attempted.join(", ") : rawCandidateIds.join(", ") || "(none)";
    throw new Error(`model not found in models.dev catalog: ${attemptedLabel}`);
  }

  const specsByCandidate = resolvedCandidates.map((candidate) => ({
    candidateId: `${candidate.providerId}/${candidate.modelId}`,
    specificationVersion: expectedSpecificationVersionForNpm(candidate.npm),
  }));
  const distinctSpecs = Array.from(
    new Set(specsByCandidate.map((entry) => entry.specificationVersion)),
  );
  if (distinctSpecs.length > 1) {
    const details = specsByCandidate
      .map((entry) => `${entry.candidateId} (${entry.specificationVersion})`)
      .join(", ");
    throw new Error(`configured model candidates must share one specification version: ${details}`);
  }

  return { resolvedCandidates, rawCandidateIds };
}
