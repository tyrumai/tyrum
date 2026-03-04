import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { APICallError } from "ai";
import type { LanguageModel } from "ai";
import type { AgentConfig as AgentConfigT } from "@tyrum/schemas";
import type { GatewayContainer } from "../../../container.js";
import type { AuthProfileRow } from "../../models/auth-profile-dal.js";
import { SessionModelOverrideDal } from "../../models/session-model-override-dal.js";
import { createProviderFromNpm } from "../../models/provider-factory.js";
import type { SecretProvider } from "../../secret/provider.js";
import { coerceRecord, coerceStringRecord } from "../../util/coerce.js";
import {
  buildProviderResolutionSetup,
  getStopFallbackApiCallError,
  isAuthInvalidStatus,
  isCredentialPaymentOrEntitlementStatus,
  isTransientStatus,
  listOrderedEligibleProfilesForProvider,
  OAUTH_REFRESH_LEASE_UNAVAILABLE,
  parseProviderModelId,
  resolveEnvApiKey,
  resolveProfileApiKey,
  resolveProviderBaseURL,
} from "./provider-resolution.js";

export interface ResolveSessionModelDeps {
  container: GatewayContainer;
  languageModelOverride?: LanguageModel;
  secretProvider: SecretProvider | undefined;
  oauthLeaseOwner: string;
  fetchImpl: typeof fetch;
}

export async function resolveSessionModel(
  deps: ResolveSessionModelDeps,
  input: {
    config: AgentConfigT;
    tenantId: string;
    sessionId: string;
    profileModelId?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<LanguageModelV3> {
  if (deps.languageModelOverride) {
    const override = deps.languageModelOverride;
    if (typeof override === "string") {
      throw new Error("languageModel override must be a LanguageModel instance, not a string id");
    }
    if ((override as Partial<LanguageModelV3>).specificationVersion !== "v3") {
      throw new Error("languageModel override must implement specificationVersion v3");
    }
    return override as LanguageModelV3;
  }

  const override = await new SessionModelOverrideDal(deps.container.db).get({
    tenantId: input.tenantId,
    sessionId: input.sessionId,
  });
  const overrideModelId = override?.model_id?.trim();

  const rawCandidateIds = [
    overrideModelId,
    input.profileModelId,
    input.config.model.model,
    ...(input.config.model.fallback ?? []),
  ]
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v, i, a) => v.length > 0 && a.indexOf(v) === i);

  const loaded = await deps.container.modelsDev.ensureLoaded();
  const catalog = loaded.catalog;

  type ProviderEntry = (typeof catalog)[string];
  type ModelEntry = NonNullable<ProviderEntry["models"]>[string];
  type ResolvedCandidate = {
    providerId: string;
    modelId: string;
    provider: ProviderEntry;
    model: ModelEntry;
    npm: string;
    api: string | undefined;
  };

  const invalidCandidateIds: string[] = [];
  const parsedCandidates: Array<{ providerId: string; modelId: string }> = [];
  const seenCandidates = new Set<string>();
  for (const rawCandidate of rawCandidateIds) {
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
    parsedCandidates.push(parsed);
  }

  if (invalidCandidateIds.length > 0) {
    throw new Error(
      `invalid agent model id(s) (expected provider/model): ${invalidCandidateIds.join(", ")}`,
    );
  }

  const resolvedCandidates: ResolvedCandidate[] = parsedCandidates
    .map((candidate): ResolvedCandidate | undefined => {
      const { providerId, modelId } = candidate;
      const provider = catalog[providerId];
      if (!provider) return undefined;
      const model = provider.models?.[modelId];
      if (!model) return undefined;

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
      };
    })
    .filter((v): v is ResolvedCandidate => Boolean(v));

  if (resolvedCandidates.length === 0) {
    const attempted = parsedCandidates.map((c) => `${c.providerId}/${c.modelId}`);
    const attemptedLabel =
      attempted.length > 0 ? attempted.join(", ") : rawCandidateIds.join(", ") || "(none)";
    throw new Error(`model not found in models.dev catalog: ${attemptedLabel}`);
  }

  const fetchImpl = input.fetchImpl ?? deps.fetchImpl;
  const {
    secretProvider,
    authProfileDal,
    pinDal,
    oauthProviderRegistry,
    oauthRefreshLeaseDal,
    logger,
    oauthLeaseOwner,
  } = buildProviderResolutionSetup({
    container: deps.container,
    secretProvider: deps.secretProvider,
    oauthLeaseOwner: deps.oauthLeaseOwner,
    fetchImpl,
  });

  async function buildRotatingModel(
    chosen: (typeof resolvedCandidates)[number],
  ): Promise<LanguageModelV3> {
    const mergedOptions = (() => {
      const modelOptions = coerceRecord((chosen.model as { options?: unknown }).options) ?? {};
      const variantOptions = (() => {
        const variant = input.config.model.variant?.trim();
        const variants = coerceRecord((chosen.model as { variants?: unknown }).variants);
        if (!variant || !variants) return {};
        return coerceRecord(variants[variant]) ?? {};
      })();
      return Object.assign({}, modelOptions, variantOptions, input.config.model.options);
    })();

    const modelHeaders = coerceStringRecord((chosen.model as { headers?: unknown }).headers) ?? {};
    const optionHeaders = coerceStringRecord(mergedOptions["headers"]) ?? {};
    const headers =
      Object.keys(modelHeaders).length > 0 || Object.keys(optionHeaders).length > 0
        ? { ...modelHeaders, ...optionHeaders }
        : undefined;

    const baseURL = resolveProviderBaseURL({
      providerEnv: chosen.provider.env,
      providerApi: chosen.api,
      options: mergedOptions,
    });

    const envApiKey = resolveEnvApiKey(chosen.provider.env);

    async function buildModelFromApiKey(apiKey: string | undefined): Promise<LanguageModelV3> {
      const sdk = createProviderFromNpm({
        npm: chosen.npm,
        providerId: chosen.providerId,
        apiKey,
        baseURL,
        headers,
        fetchImpl,
        options: mergedOptions,
      });

      const model = sdk.languageModel(chosen.modelId);
      if (typeof model === "string") {
        throw new Error(
          `provider returned string model id for '${chosen.providerId}/${chosen.modelId}'`,
        );
      }
      if ((model as Partial<LanguageModelV3>).specificationVersion !== "v3") {
        throw new Error(
          `provider model '${chosen.providerId}/${chosen.modelId}' is not specificationVersion v3`,
        );
      }
      return model as LanguageModelV3;
    }

    async function resolveApiKeyFromProfile(
      profile: AuthProfileRow,
      opts?: { forceOAuthRefresh?: boolean },
    ): Promise<string | null> {
      return await resolveProfileApiKey(
        profile,
        {
          tenantId: input.tenantId,
          secretProvider,
          oauthProviderRegistry,
          oauthRefreshLeaseDal,
          oauthLeaseOwner,
          logger,
          fetchImpl,
        },
        opts,
      );
    }

    const providerLabel = `${chosen.providerId}/${chosen.modelId}`;

    const supportedUrls: PromiseLike<Record<string, RegExp[]>> = (async () => {
      try {
        const model = await buildModelFromApiKey(undefined);
        return await Promise.resolve(model.supportedUrls);
      } catch {
        // Intentional: supportedUrls introspection is best-effort; treat supported URLs as unknown.
        return {};
      }
    })();

    async function callWithRotation<T>(
      options: LanguageModelV3CallOptions,
      invoke: (model: LanguageModelV3, options: LanguageModelV3CallOptions) => PromiseLike<T>,
    ): Promise<T> {
      let lastErr: unknown;

      const orderedProfiles = await listOrderedEligibleProfilesForProvider({
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        providerKey: chosen.providerId,
        authProfileDal,
        pinDal,
      });

      for (const profile of orderedProfiles) {
        const apiKey = await resolveApiKeyFromProfile(profile);
        if (!apiKey) continue;

        const model = await buildModelFromApiKey(apiKey);
        try {
          const res = await invoke(model, options);
          if (input.sessionId) {
            void pinDal
              .upsert({
                tenantId: input.tenantId,
                sessionId: input.sessionId,
                providerKey: chosen.providerId,
                authProfileId: profile.auth_profile_id,
              })
              .catch(() => {});
          }
          return res;
        } catch (err) {
          lastErr = err;
          if (APICallError.isInstance(err)) {
            const status = err.statusCode;
            if (isAuthInvalidStatus(status)) {
              if (profile.type === "oauth") {
                const refreshedApiKey = await resolveApiKeyFromProfile(profile, {
                  forceOAuthRefresh: true,
                });
                if (refreshedApiKey === OAUTH_REFRESH_LEASE_UNAVAILABLE) {
                  // Refresh couldn't run (for example the lease is held by another instance).
                  // Keep the profile active and rotate to the next eligible credential.
                  continue;
                }
                if (refreshedApiKey) {
                  const refreshedModel = await buildModelFromApiKey(refreshedApiKey);
                  try {
                    const res = await invoke(refreshedModel, options);
                    if (input.sessionId) {
                      void pinDal
                        .upsert({
                          tenantId: input.tenantId,
                          sessionId: input.sessionId,
                          providerKey: chosen.providerId,
                          authProfileId: profile.auth_profile_id,
                        })
                        .catch(() => {});
                    }
                    return res;
                  } catch (retryErr) {
                    lastErr = retryErr;
                    if (APICallError.isInstance(retryErr)) {
                      const retryStatus = retryErr.statusCode;
                      if (isAuthInvalidStatus(retryStatus)) {
                        // fall through to disable below
                      } else if (isTransientStatus(retryStatus)) {
                        continue;
                      } else if (isCredentialPaymentOrEntitlementStatus(retryStatus)) {
                        continue;
                      } else {
                        throw retryErr;
                      }
                    } else {
                      continue;
                    }
                  }
                }
              }

              await authProfileDal
                .disableByKey({
                  tenantId: input.tenantId,
                  authProfileKey: profile.auth_profile_key,
                })
                .catch(() => {});
              continue;
            }
            if (isTransientStatus(status)) {
              continue;
            }
            if (isCredentialPaymentOrEntitlementStatus(status)) {
              continue;
            }
            throw err;
          }

          // Non-HTTP errors: treat as transient and rotate.
          continue;
        }
      }

      // Fall back to environment-provided credentials (single attempt; no pinning).
      try {
        const model = await buildModelFromApiKey(envApiKey);
        return await invoke(model, options);
      } catch (err) {
        lastErr = err;
      }

      const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
      throw new Error(`model call failed for ${providerLabel}: ${message}`, { cause: lastErr });
    }

    const rotating: LanguageModelV3 = {
      specificationVersion: "v3",
      provider: chosen.providerId,
      modelId: chosen.modelId,
      supportedUrls,

      async doGenerate(
        options: LanguageModelV3CallOptions,
      ): Promise<LanguageModelV3GenerateResult> {
        return await callWithRotation(options, (model, opts) => model.doGenerate(opts));
      },

      async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
        return await callWithRotation(options, (model, opts) => model.doStream(opts));
      },
    };

    return rotating;
  }

  const rotatingModels: LanguageModelV3[] = [];
  for (const entry of resolvedCandidates) {
    rotatingModels.push(await buildRotatingModel(entry));
  }

  if (rotatingModels.length === 1) {
    return rotatingModels[0]!;
  }

  const attempted = resolvedCandidates
    .map((entry) => `${entry.providerId}/${entry.modelId}`)
    .join(", ");
  const primary = rotatingModels[0]!;

  const multi: LanguageModelV3 = {
    specificationVersion: "v3",
    provider: primary.provider,
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,

    async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
      let lastErr: unknown;
      for (const model of rotatingModels) {
        try {
          return await model.doGenerate(options);
        } catch (err) {
          if (getStopFallbackApiCallError(err)) throw err;
          lastErr = err;
        }
      }
      const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
      throw new Error(`model call failed for candidates ${attempted}: ${message}`);
    },

    async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
      let lastErr: unknown;
      for (const model of rotatingModels) {
        try {
          return await model.doStream(options);
        } catch (err) {
          if (getStopFallbackApiCallError(err)) throw err;
          lastErr = err;
        }
      }
      const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
      throw new Error(`model call failed for candidates ${attempted}: ${message}`);
    },
  };

  return multi;
}
