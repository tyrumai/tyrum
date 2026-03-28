import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { APICallError } from "ai";
import type { LanguageModel } from "ai";
import type { AgentConfig as AgentConfigT } from "@tyrum/contracts";
import type { AuthProfileRow } from "../../models/auth-profile-dal.js";
import { createProviderFromNpm } from "../../models/provider-factory.js";
import { coerceRecord, coerceStringRecord } from "../../util/coerce.js";
import {
  buildProviderResolutionSetup,
  getStopFallbackApiCallError,
  isAuthInvalidStatus,
  isCredentialPaymentOrEntitlementStatus,
  isTransientStatus,
  listOrderedEligibleProfilesForProvider,
  OAUTH_REFRESH_LEASE_UNAVAILABLE,
  providerRequiresConfiguredAccount,
  resolveProfileSecrets,
  resolveProviderBaseURL,
} from "./provider-resolution.js";
import {
  expectedSpecificationVersionForNpm,
  type ResolvedCandidate,
  resolveCandidates,
} from "./conversation-model-resolution-helpers.js";
import type { ResolveConversationModelDeps } from "./conversation-model-resolution-helpers.js";

export type { ResolveConversationModelDeps } from "./conversation-model-resolution-helpers.js";

export type ResolvedConversationModel = {
  model: LanguageModel;
  candidates: ResolvedCandidate[];
};

async function resolveConversationModelWithMetadata(
  deps: ResolveConversationModelDeps,
  input: {
    config: AgentConfigT;
    tenantId: string;
    conversationId: string;
    executionProfileId?: string;
    profileModelId?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<ResolvedConversationModel> {
  if (deps.languageModelOverride) {
    const override = deps.languageModelOverride;
    if (typeof override === "string") {
      throw new Error("languageModel override must be a LanguageModel instance, not a string id");
    }
    return { model: override, candidates: [] };
  }

  const { resolvedCandidates } = await resolveCandidates(deps, input);

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

  type ResolvedLanguageModel = LanguageModelV2 | LanguageModelV3;

  async function buildRotatingModel(
    chosen: (typeof resolvedCandidates)[number],
  ): Promise<ResolvedLanguageModel> {
    const mergedOptions = (() => {
      const providerOptions =
        coerceRecord((chosen.provider as { options?: unknown }).options) ?? {};
      const modelOptions = coerceRecord((chosen.model as { options?: unknown }).options) ?? {};
      const variantOptions = (() => {
        const variant = input.config.model.variant?.trim();
        const variants = coerceRecord((chosen.model as { variants?: unknown }).variants);
        if (!variant || !variants) return {};
        return coerceRecord(variants[variant]) ?? {};
      })();
      return Object.assign(
        {},
        providerOptions,
        modelOptions,
        variantOptions,
        chosen.optionsOverride ?? {},
        input.config.model.options,
      );
    })();

    const providerHeaders =
      coerceStringRecord((chosen.provider as { headers?: unknown }).headers) ?? {};
    const modelHeaders = coerceStringRecord((chosen.model as { headers?: unknown }).headers) ?? {};
    const optionHeaders = coerceStringRecord(mergedOptions["headers"]) ?? {};
    const headers =
      Object.keys(providerHeaders).length > 0 ||
      Object.keys(modelHeaders).length > 0 ||
      Object.keys(optionHeaders).length > 0
        ? { ...providerHeaders, ...modelHeaders, ...optionHeaders }
        : undefined;

    const expectedSpec = expectedSpecificationVersionForNpm(chosen.npm);
    const providerLabel = `${chosen.providerId}/${chosen.modelId}`;
    const supportedUrls: PromiseLike<Record<string, RegExp[]>> = Promise.resolve({});
    const requiresConfiguredAccount = providerRequiresConfiguredAccount({
      providerApi: chosen.api,
      providerEnv: (chosen.provider as { env?: unknown }).env,
    });
    const missingCredentialsError = () =>
      new Error(
        `no active auth profiles with credentials configured for provider '${chosen.providerId}'`,
      );
    const pinConversationProfile = (authProfileId: string): void => {
      if (!input.conversationId) return;
      void pinDal
        .upsert({
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          providerKey: chosen.providerId,
          authProfileId,
        })
        .catch(() => {});
    };
    const invokeModel = async <T, TCallOptions>(
      model: ResolvedLanguageModel,
      options: TCallOptions,
      invoke: (model: ResolvedLanguageModel, options: TCallOptions) => PromiseLike<T>,
      authProfileId?: string,
    ): Promise<T> => {
      const result = await invoke(model, options);
      if (authProfileId) pinConversationProfile(authProfileId);
      return result;
    };

    async function buildModelFromProfile(
      profile?: AuthProfileRow,
      opts?: { forceOAuthRefresh?: boolean },
    ): Promise<ResolvedLanguageModel | null | typeof OAUTH_REFRESH_LEASE_UNAVAILABLE> {
      const resolvedSecrets = profile
        ? await resolveProfileSecrets(
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
          )
        : {};
      if (resolvedSecrets === OAUTH_REFRESH_LEASE_UNAVAILABLE) {
        return OAUTH_REFRESH_LEASE_UNAVAILABLE;
      }
      if (!resolvedSecrets) {
        return null;
      }

      const profileConfig =
        profile?.config && typeof profile.config === "object"
          ? (profile.config as Record<string, unknown>)
          : undefined;
      const apiKey =
        resolvedSecrets["api_key"] ??
        resolvedSecrets["token"] ??
        resolvedSecrets["access_token"] ??
        undefined;
      const baseURL = resolveProviderBaseURL({
        providerApi: chosen.api,
        options: mergedOptions,
        config: profileConfig,
        secrets: resolvedSecrets,
      });
      const sdk = createProviderFromNpm({
        npm: chosen.npm,
        providerId: chosen.providerId,
        apiKey,
        headers,
        fetchImpl,
        options: mergedOptions,
        baseURL,
        config: profileConfig,
        secrets: resolvedSecrets,
      });

      const model = sdk.languageModel(chosen.modelId);
      if (typeof model === "string") {
        throw new Error(
          `provider returned string model id for '${chosen.providerId}/${chosen.modelId}'`,
        );
      }
      if ((model as Partial<ResolvedLanguageModel>).specificationVersion !== expectedSpec) {
        throw new Error(
          `provider model '${chosen.providerId}/${chosen.modelId}' is not specificationVersion ${expectedSpec}`,
        );
      }
      return model as ResolvedLanguageModel;
    }

    async function callWithRotation<T, TCallOptions>(
      options: TCallOptions,
      invoke: (model: ResolvedLanguageModel, options: TCallOptions) => PromiseLike<T>,
    ): Promise<T> {
      let lastErr: unknown;

      const orderedProfiles = await listOrderedEligibleProfilesForProvider({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        providerKey: chosen.providerId,
        authProfileDal,
        pinDal,
      });

      if (orderedProfiles.length === 0) {
        if (requiresConfiguredAccount) throw missingCredentialsError();
        const model = await buildModelFromProfile();
        if (!model || model === OAUTH_REFRESH_LEASE_UNAVAILABLE) throw missingCredentialsError();
        return await invokeModel(model, options, invoke);
      }

      for (const profile of orderedProfiles) {
        const model = await buildModelFromProfile(profile);
        if (!model || model === OAUTH_REFRESH_LEASE_UNAVAILABLE) continue;
        try {
          return await invokeModel(model, options, invoke, profile.auth_profile_id);
        } catch (err) {
          lastErr = err;
          if (APICallError.isInstance(err)) {
            const status = err.statusCode;
            if (isAuthInvalidStatus(status)) {
              if (profile.type === "oauth") {
                const refreshedModel = await buildModelFromProfile(profile, {
                  forceOAuthRefresh: true,
                });
                if (refreshedModel === OAUTH_REFRESH_LEASE_UNAVAILABLE) {
                  // Refresh couldn't run (for example the lease is held by another instance).
                  // Keep the profile active and rotate to the next eligible credential.
                  continue;
                }
                if (refreshedModel) {
                  try {
                    return await invokeModel(
                      refreshedModel,
                      options,
                      invoke,
                      profile.auth_profile_id,
                    );
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

      if (!lastErr) lastErr = missingCredentialsError();

      const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
      throw new Error(`model call failed for ${providerLabel}: ${message}`, { cause: lastErr });
    }

    if (expectedSpec === "v2") {
      return {
        specificationVersion: "v2",
        provider: chosen.providerId,
        modelId: chosen.modelId,
        supportedUrls,
        async doGenerate(options: LanguageModelV2CallOptions) {
          return await callWithRotation(options, (model, opts) =>
            (model as LanguageModelV2).doGenerate(opts as LanguageModelV2CallOptions),
          );
        },
        async doStream(options: LanguageModelV2CallOptions) {
          return await callWithRotation(options, (model, opts) =>
            (model as LanguageModelV2).doStream(opts as LanguageModelV2CallOptions),
          );
        },
      };
    }

    return {
      specificationVersion: "v3",
      provider: chosen.providerId,
      modelId: chosen.modelId,
      supportedUrls,
      async doGenerate(
        options: LanguageModelV3CallOptions,
      ): Promise<LanguageModelV3GenerateResult> {
        return await callWithRotation(options, (model, opts) =>
          (model as LanguageModelV3).doGenerate(opts as LanguageModelV3CallOptions),
        );
      },
      async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
        return await callWithRotation(options, (model, opts) =>
          (model as LanguageModelV3).doStream(opts as LanguageModelV3CallOptions),
        );
      },
    };
  }

  const rotatingModels = await Promise.all(
    resolvedCandidates.map((entry) => buildRotatingModel(entry)),
  );
  if (rotatingModels.length === 1) {
    return { model: rotatingModels[0]!, candidates: resolvedCandidates };
  }

  const primarySpec = rotatingModels[0]!.specificationVersion;
  const compatibleRotatingModels = rotatingModels.filter(
    (model): model is ResolvedLanguageModel => model.specificationVersion === primarySpec,
  );
  if (compatibleRotatingModels.length === 1) {
    return { model: compatibleRotatingModels[0]!, candidates: resolvedCandidates };
  }

  const attempted = resolvedCandidates
    .map((entry) => `${entry.providerId}/${entry.modelId}`)
    .join(", ");
  const primary = compatibleRotatingModels[0]!;
  async function callCompatibleModels<T, TCallOptions>(
    options: TCallOptions,
    invoke: (model: ResolvedLanguageModel, options: TCallOptions) => PromiseLike<T>,
  ): Promise<T> {
    let lastErr: unknown;
    for (const model of compatibleRotatingModels) {
      try {
        return await invoke(model, options);
      } catch (err) {
        if (getStopFallbackApiCallError(err)) throw err;
        lastErr = err;
      }
    }
    const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`model call failed for candidates ${attempted}: ${message}`);
  }

  if (primarySpec === "v2") {
    return {
      model: {
        specificationVersion: "v2",
        provider: primary.provider,
        modelId: primary.modelId,
        supportedUrls: primary.supportedUrls,
        async doGenerate(options: LanguageModelV2CallOptions) {
          return await callCompatibleModels(options, (model, currentOptions) =>
            (model as LanguageModelV2).doGenerate(currentOptions as LanguageModelV2CallOptions),
          );
        },
        async doStream(options: LanguageModelV2CallOptions) {
          return await callCompatibleModels(options, (model, currentOptions) =>
            (model as LanguageModelV2).doStream(currentOptions as LanguageModelV2CallOptions),
          );
        },
      },
      candidates: resolvedCandidates,
    };
  }

  return {
    model: {
      specificationVersion: "v3",
      provider: primary.provider,
      modelId: primary.modelId,
      supportedUrls: primary.supportedUrls,
      async doGenerate(
        options: LanguageModelV3CallOptions,
      ): Promise<LanguageModelV3GenerateResult> {
        return await callCompatibleModels(options, (model, currentOptions) =>
          (model as LanguageModelV3).doGenerate(currentOptions as LanguageModelV3CallOptions),
        );
      },
      async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
        return await callCompatibleModels(options, (model, currentOptions) =>
          (model as LanguageModelV3).doStream(currentOptions as LanguageModelV3CallOptions),
        );
      },
    },
    candidates: resolvedCandidates,
  };
}

export async function resolveConversationModel(
  deps: ResolveConversationModelDeps,
  input: {
    config: AgentConfigT;
    tenantId: string;
    conversationId: string;
    executionProfileId?: string;
    profileModelId?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<LanguageModel> {
  return (await resolveConversationModelWithMetadata(deps, input)).model;
}

export async function resolveConversationModelDetailed(
  deps: ResolveConversationModelDeps,
  input: {
    config: AgentConfigT;
    tenantId: string;
    conversationId: string;
    executionProfileId?: string;
    profileModelId?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<ResolvedConversationModel> {
  return await resolveConversationModelWithMetadata(deps, input);
}
