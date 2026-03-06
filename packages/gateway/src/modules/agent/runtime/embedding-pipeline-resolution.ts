import type { EmbeddingModel } from "ai";
import type { GatewayContainer } from "../../../container.js";
import { EmbeddingPipeline } from "../../memory/embedding-pipeline.js";
import { VectorDal } from "../../memory/vector-dal.js";
import { createProviderFromNpm } from "../../models/provider-factory.js";
import type { SecretProvider } from "../../secret/provider.js";
import {
  buildProviderResolutionSetup,
  listOrderedEligibleProfilesForProvider,
  OAUTH_REFRESH_LEASE_UNAVAILABLE,
  parseProviderModelId,
  resolveProfileSecrets,
  resolveProviderBaseURL,
} from "./provider-resolution.js";

type ProviderCatalog = Awaited<
  ReturnType<GatewayContainer["modelCatalog"]["getEffectiveCatalog"]>
>["catalog"];
type ProviderEntry = ProviderCatalog[string];
type ModelEntry = NonNullable<ProviderEntry["models"]>[string];
type ProviderResolutionDeps = ReturnType<typeof buildProviderResolutionSetup>;

interface EmbeddingModelProviderSdk {
  textEmbeddingModel?: (modelId: string) => EmbeddingModel;
  embeddingModel?: (modelId: string) => EmbeddingModel;
}

interface ResolvedEmbeddingCandidate {
  providerId: string;
  modelId: string;
  provider: ProviderEntry;
  model: ModelEntry;
  npm: string;
  api: string | undefined;
}

function isEmbeddingModel(id: string, model: ModelEntry): boolean {
  if (/embedding/i.test(id)) return true;

  const family = (model as { family?: unknown }).family;
  if (typeof family === "string" && /embedding/i.test(family)) return true;

  const name = (model as { name?: unknown }).name;
  return typeof name === "string" && /embedding/i.test(name);
}

function resolveEmbeddingCandidate(
  catalog: ProviderCatalog,
  providerId: string,
): ResolvedEmbeddingCandidate | undefined {
  const provider = catalog[providerId];
  if (!provider) return undefined;

  const providerEnabled = (provider as { enabled?: boolean }).enabled ?? true;
  if (!providerEnabled) return undefined;

  const models = provider.models ?? {};
  const preferredIds = ["text-embedding-3-small", "text-embedding-3-large"];
  const embeddingModelId =
    preferredIds.find((id) => {
      const candidate = models[id];
      return candidate ? ((candidate as { enabled?: boolean }).enabled ?? true) : false;
    }) ??
    Object.entries(models)
      .filter(
        ([id, model]) =>
          ((model as { enabled?: boolean }).enabled ?? true) && isEmbeddingModel(id, model),
      )
      .map(([id]) => id)
      .toSorted((left, right) => left.localeCompare(right))[0];
  if (!embeddingModelId) return undefined;

  const model = models[embeddingModelId];
  if (!model) return undefined;

  const providerOverride = (model as { provider?: { npm?: string; api?: string } }).provider;
  const npm = providerOverride?.npm ?? provider.npm;
  if (!npm) return undefined;

  return {
    providerId,
    modelId: embeddingModelId,
    provider,
    model,
    npm,
    api: providerOverride?.api ?? provider.api,
  };
}

function buildOrderedProviderIds(catalog: ProviderCatalog, primaryModelId: string): string[] {
  const primaryProviderId = (() => {
    try {
      return parseProviderModelId(primaryModelId).providerId;
    } catch {
      // Intentional: primary model id may not follow provider/model format; treat as unknown.
      return undefined;
    }
  })();

  const orderedProviderIds: string[] = [];
  const seen = new Set<string>();
  const addProvider = (id: string | undefined): void => {
    const trimmed = id?.trim();
    if (!trimmed || seen.has(trimmed)) return;

    const provider = catalog[trimmed];
    const enabled = provider ? ((provider as { enabled?: boolean }).enabled ?? true) : false;
    if (!enabled) return;

    seen.add(trimmed);
    orderedProviderIds.push(trimmed);
  };

  addProvider(primaryProviderId);
  addProvider("openai");
  for (const id of Object.keys(catalog).toSorted((left, right) => left.localeCompare(right))) {
    addProvider(id);
  }
  return orderedProviderIds;
}

function resolveSdkEmbeddingModel(sdk: unknown, modelId: string): EmbeddingModel | undefined {
  const providerSdk = sdk as EmbeddingModelProviderSdk;
  if (typeof providerSdk.textEmbeddingModel === "function") {
    return providerSdk.textEmbeddingModel(modelId);
  }
  if (typeof providerSdk.embeddingModel === "function") {
    return providerSdk.embeddingModel(modelId);
  }
  return undefined;
}

async function resolveProviderAccount(input: {
  deps: ProviderResolutionDeps;
  tenantId: string;
  sessionId: string;
  providerId: string;
}): Promise<
  | {
      profile: Awaited<ReturnType<typeof listOrderedEligibleProfilesForProvider>>[number];
      secrets: Record<string, string>;
    }
  | undefined
> {
  const orderedProfiles = await listOrderedEligibleProfilesForProvider({
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    providerKey: input.providerId,
    authProfileDal: input.deps.authProfileDal,
    pinDal: input.deps.pinDal,
  });

  for (const profile of orderedProfiles) {
    const secrets = await resolveProfileSecrets(profile, {
      tenantId: input.tenantId,
      secretProvider: input.deps.secretProvider,
      oauthProviderRegistry: input.deps.oauthProviderRegistry,
      oauthRefreshLeaseDal: input.deps.oauthRefreshLeaseDal,
      oauthLeaseOwner: input.deps.oauthLeaseOwner,
      logger: input.deps.logger,
      fetchImpl: input.deps.fetchImpl,
    });
    if (secrets && secrets !== OAUTH_REFRESH_LEASE_UNAVAILABLE) {
      return { profile, secrets };
    }
  }

  return undefined;
}

function providerRequiresConfiguredAccount(candidate: ResolvedEmbeddingCandidate): boolean {
  if (/\$\{[A-Z0-9_]+\}/.test(candidate.api ?? "")) {
    return true;
  }
  const providerEnv = (candidate.provider as { env?: unknown }).env;
  return Array.isArray(providerEnv)
    ? providerEnv.some((entry) => typeof entry === "string" && entry.trim().length > 0)
    : true;
}

function buildEmbeddingPipeline(input: {
  db: GatewayContainer["db"];
  fetchImpl: typeof fetch;
  candidate: ResolvedEmbeddingCandidate;
  tenantId: string;
  agentId: string;
  providerAccount?: {
    profile: Awaited<ReturnType<typeof listOrderedEligibleProfilesForProvider>>[number];
    secrets: Record<string, string>;
  };
}): EmbeddingPipeline | undefined {
  const profileConfig =
    input.providerAccount?.profile.config &&
    typeof input.providerAccount.profile.config === "object"
      ? (input.providerAccount.profile.config as Record<string, unknown>)
      : undefined;
  const secrets = input.providerAccount?.secrets;
  const apiKey = secrets?.["api_key"] ?? secrets?.["token"] ?? secrets?.["access_token"];
  const sdk = createProviderFromNpm({
    npm: input.candidate.npm,
    providerId: input.candidate.providerId,
    apiKey,
    baseURL: resolveProviderBaseURL({
      providerApi: input.candidate.api,
      config: profileConfig,
      secrets,
    }),
    fetchImpl: input.fetchImpl,
    config: profileConfig,
    secrets,
  });
  const embeddingModel = resolveSdkEmbeddingModel(sdk, input.candidate.modelId);
  if (!embeddingModel) return undefined;

  return new EmbeddingPipeline({
    vectorDal: new VectorDal(input.db),
    scope: { tenantId: input.tenantId, agentId: input.agentId },
    embeddingModel,
    embeddingModelId: `${input.candidate.providerId}/${input.candidate.modelId}`,
  });
}

export async function resolveEmbeddingPipeline(input: {
  container: GatewayContainer;
  secretProvider?: SecretProvider;
  instanceOwner: string;
  fetchImpl: typeof fetch;
  primaryModelId: string;
  sessionId: string;
  tenantId: string;
  agentId: string;
}): Promise<EmbeddingPipeline | undefined> {
  try {
    const { catalog } = await input.container.modelCatalog.getEffectiveCatalog({
      tenantId: input.tenantId,
    });
    const providerIds = buildOrderedProviderIds(catalog, input.primaryModelId);
    const deps = buildProviderResolutionSetup({
      container: input.container,
      secretProvider: input.secretProvider,
      oauthLeaseOwner: input.instanceOwner,
      fetchImpl: input.fetchImpl,
    });

    for (const providerId of providerIds) {
      const candidate = resolveEmbeddingCandidate(catalog, providerId);
      if (!candidate) continue;

      const providerAccount = await resolveProviderAccount({
        deps,
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        providerId: candidate.providerId,
      });
      if (!providerAccount && providerRequiresConfiguredAccount(candidate)) continue;

      const pipeline = buildEmbeddingPipeline({
        db: input.container.db,
        fetchImpl: input.fetchImpl,
        candidate,
        tenantId: input.tenantId,
        agentId: input.agentId,
        providerAccount,
      });
      if (pipeline) return pipeline;
    }

    return undefined;
  } catch {
    // Intentional: embedding pipeline resolution is best-effort; fall back to other retrieval strategies.
    return undefined;
  }
}
