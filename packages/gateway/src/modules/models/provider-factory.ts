import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createCerebras } from "@ai-sdk/cerebras";
import { createCohere } from "@ai-sdk/cohere";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createGateway } from "@ai-sdk/gateway";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createPerplexity } from "@ai-sdk/perplexity";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createVercel } from "@ai-sdk/vercel";
import { createXai } from "@ai-sdk/xai";
import { createGitLab } from "@gitlab/gitlab-ai-provider";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createSAPAIProvider } from "@jerome-benoit/sap-ai-provider-v2";
import { createAiGateway } from "ai-gateway-provider";
import { createUnified } from "ai-gateway-provider/providers/unified";
import { createVenice } from "venice-ai-sdk-provider";

export type ProviderInstance = {
  languageModel: (modelId: string) => unknown;
  textEmbeddingModel?: (modelId: string) => unknown;
  embeddingModel?: (modelId: string) => unknown;
};

export type ProviderFactoryInput = {
  npm: string;
  providerId: string;
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  options?: Record<string, unknown>;
  config?: Record<string, unknown>;
  secrets?: Record<string, string | undefined>;
};

type ProviderFactory = (input: ProviderFactoryInput) => ProviderInstance;

function readString(
  source: Record<string, unknown> | Record<string, string | undefined> | undefined,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readBoolean(
  source: Record<string, unknown> | undefined,
  keys: string[],
): boolean | undefined {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function resolveApiKey(input: ProviderFactoryInput): string | undefined {
  return (
    readString(input.secrets, ["api_key", "token", "access_token"]) ??
    (typeof input.apiKey === "string" && input.apiKey.trim().length > 0
      ? input.apiKey.trim()
      : undefined)
  );
}

function mergeHeaders(input: ProviderFactoryInput): Record<string, string> | undefined {
  const fromOptions = input.options?.["headers"];
  const fromOptionHeaders =
    fromOptions && typeof fromOptions === "object" && !Array.isArray(fromOptions)
      ? (fromOptions as Record<string, string>)
      : undefined;
  if (!fromOptionHeaders && !input.headers) return undefined;
  return Object.assign({}, fromOptionHeaders, input.headers);
}

function buildSimpleOptions(input: ProviderFactoryInput): Record<string, unknown> {
  const mergedHeaders = mergeHeaders(input);
  const apiKey = resolveApiKey(input);
  return Object.assign(
    {},
    input.options,
    apiKey ? { apiKey } : undefined,
    input.baseURL ? { baseURL: input.baseURL } : undefined,
    mergedHeaders ? { headers: mergedHeaders } : undefined,
    input.fetchImpl ? { fetch: input.fetchImpl } : undefined,
  );
}

function parseJsonSecret(secret: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(secret) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid ${label}: ${message}`);
  }
}

let sapEnvScopeTail: Promise<void> = Promise.resolve();

async function withScopedEnv<T>(env: Record<string, string>, fn: () => Promise<T> | T): Promise<T> {
  // SAP's V2 provider currently reads auth from process.env, so serialize those
  // calls to prevent concurrent requests from leaking each other's service keys.
  const previousScope = sapEnvScopeTail;
  let releaseScope!: () => void;
  sapEnvScopeTail = new Promise<void>((resolve) => {
    releaseScope = resolve;
  });

  await previousScope;

  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    releaseScope();
  }
}

function wrapSapModel(model: unknown, env: Record<string, string>): unknown {
  if (!model || typeof model !== "object") return model;
  const candidate = model as {
    doGenerate?: (...args: unknown[]) => Promise<unknown>;
    doStream?: (...args: unknown[]) => Promise<unknown>;
    doEmbed?: (...args: unknown[]) => Promise<unknown>;
  };
  return {
    ...candidate,
    ...(typeof candidate.doGenerate === "function"
      ? {
          async doGenerate(...args: unknown[]) {
            return await withScopedEnv(env, () => candidate.doGenerate!(...args));
          },
        }
      : {}),
    ...(typeof candidate.doStream === "function"
      ? {
          async doStream(...args: unknown[]) {
            return await withScopedEnv(env, () => candidate.doStream!(...args));
          },
        }
      : {}),
    ...(typeof candidate.doEmbed === "function"
      ? {
          async doEmbed(...args: unknown[]) {
            return await withScopedEnv(env, () => candidate.doEmbed!(...args));
          },
        }
      : {}),
  };
}

function wrapSapProvider(
  provider: ProviderInstance,
  env: Record<string, string>,
): ProviderInstance {
  return {
    languageModel(modelId: string) {
      return wrapSapModel(provider.languageModel(modelId), env);
    },
    textEmbeddingModel:
      typeof provider.textEmbeddingModel === "function"
        ? (modelId: string) => wrapSapModel(provider.textEmbeddingModel!(modelId), env)
        : undefined,
    embeddingModel:
      typeof provider.embeddingModel === "function"
        ? (modelId: string) => wrapSapModel(provider.embeddingModel!(modelId), env)
        : undefined,
  };
}

function createSimpleFactory(
  factory: (options: Record<string, unknown>) => unknown,
): ProviderFactory {
  return (input) => {
    const options = buildSimpleOptions(input);
    if (input.npm === "@ai-sdk/openai-compatible") {
      options["name"] = input.providerId;
    }
    return factory(options) as ProviderInstance;
  };
}

function createAzureFactory(input: ProviderFactoryInput): ProviderInstance {
  const options = buildSimpleOptions(input);
  const resourceName = readString(input.config, ["resourceName"]);
  const apiVersion = readString(input.config, ["apiVersion"]);
  const useDeploymentBasedUrls = readBoolean(input.config, ["useDeploymentBasedUrls"]);
  if (resourceName) {
    options["resourceName"] = resourceName;
  }
  if (apiVersion) {
    options["apiVersion"] = apiVersion;
  }
  if (typeof useDeploymentBasedUrls === "boolean") {
    options["useDeploymentBasedUrls"] = useDeploymentBasedUrls;
  }
  return createAzure(options) as ProviderInstance;
}

function createAmazonBedrockFactory(input: ProviderFactoryInput): ProviderInstance {
  const options = buildSimpleOptions(input);
  const region = readString(input.config, ["region"]);
  if (region) {
    options["region"] = region;
  }

  const accessKeyId = readString(input.secrets, ["accessKeyId"]);
  const secretAccessKey = readString(input.secrets, ["secretAccessKey"]);
  const sessionToken = readString(input.secrets, ["sessionToken"]);
  if (accessKeyId) {
    options["accessKeyId"] = accessKeyId;
  }
  if (secretAccessKey) {
    options["secretAccessKey"] = secretAccessKey;
  }
  if (sessionToken) {
    options["sessionToken"] = sessionToken;
  }

  return createAmazonBedrock(options) as ProviderInstance;
}

function createVertexFactory(input: ProviderFactoryInput): ProviderInstance {
  const options = buildSimpleOptions(input);
  const project = readString(input.config, ["project"]);
  const location = readString(input.config, ["location"]);
  const credentialsJson = readString(input.secrets, [
    "googleCredentialsJson",
    "GOOGLE_APPLICATION_CREDENTIALS",
  ]);

  if (project) {
    options["project"] = project;
  }
  if (location) {
    options["location"] = location;
  }
  if (credentialsJson) {
    options["googleAuthOptions"] = {
      credentials: parseJsonSecret(credentialsJson, "Google service-account JSON"),
    };
  }

  return createVertex(options) as ProviderInstance;
}

function createVertexAnthropicFactory(input: ProviderFactoryInput): ProviderInstance {
  const options = buildSimpleOptions(input);
  const project = readString(input.config, ["project"]);
  const location = readString(input.config, ["location"]);
  const credentialsJson = readString(input.secrets, [
    "googleCredentialsJson",
    "GOOGLE_APPLICATION_CREDENTIALS",
  ]);

  if (project) {
    options["project"] = project;
  }
  if (location) {
    options["location"] = location;
  }
  if (credentialsJson) {
    options["googleAuthOptions"] = {
      credentials: parseJsonSecret(credentialsJson, "Google service-account JSON"),
    };
  }

  return createVertexAnthropic(options) as ProviderInstance;
}

function createCloudflareAiGatewayFactory(input: ProviderFactoryInput): ProviderInstance {
  const accountId = readString(input.config, ["accountId", "CLOUDFLARE_ACCOUNT_ID"]);
  const gateway = readString(input.config, ["gateway", "gatewayId", "CLOUDFLARE_GATEWAY_ID"]);
  if (!accountId || !gateway) {
    throw new Error("cloudflare-ai-gateway requires accountId and gateway configuration values");
  }

  const aiGateway = createAiGateway({
    accountId,
    gateway,
    apiKey: resolveApiKey(input),
  });
  const unified = createUnified({
    headers: mergeHeaders(input),
    fetch: input.fetchImpl,
  });

  return {
    languageModel(modelId: string) {
      return aiGateway(unified.languageModel(modelId));
    },
  };
}

function createGitLabFactory(input: ProviderFactoryInput): ProviderInstance {
  const options = {
    apiKey: resolveApiKey(input),
    instanceUrl: readString(input.config, ["instanceUrl"]),
    refreshToken: readString(input.secrets, ["refreshToken", "refresh_token"]),
    clientId: readString(input.config, ["clientId"]),
    redirectUri: readString(input.config, ["redirectUri"]),
    headers: mergeHeaders(input),
    fetch: input.fetchImpl,
    name: input.providerId,
    aiGatewayUrl: readString(input.config, ["aiGatewayUrl"]),
  } satisfies Record<string, unknown>;
  return createGitLab(options) as ProviderInstance;
}

function createSapFactory(input: ProviderFactoryInput): ProviderInstance {
  const serviceKey = readString(input.secrets, ["service_key", "AICORE_SERVICE_KEY"]);
  if (!serviceKey) {
    throw new Error("sap-ai-core requires a service_key secret");
  }

  const provider = createSAPAIProvider({
    api: readString(input.config, ["api"]) as "foundation-models" | "orchestration" | undefined,
    deploymentId: readString(input.config, ["deploymentId"]),
    resourceGroup: readString(input.config, ["resourceGroup"]),
    name: input.providerId,
  }) as ProviderInstance;

  return wrapSapProvider(provider, { AICORE_SERVICE_KEY: serviceKey });
}

function createVeniceFactory(input: ProviderFactoryInput): ProviderInstance {
  const options = buildSimpleOptions(input);
  options["name"] = input.providerId;
  return createVenice(options) as unknown as ProviderInstance;
}

const FACTORIES: Record<string, ProviderFactory> = {
  "@ai-sdk/amazon-bedrock": createAmazonBedrockFactory,
  "@ai-sdk/anthropic": createSimpleFactory(
    createAnthropic as unknown as (options: Record<string, unknown>) => unknown,
  ),
  "@ai-sdk/azure": createAzureFactory,
  "@ai-sdk/cerebras": createSimpleFactory(
    createCerebras as unknown as (options: Record<string, unknown>) => unknown,
  ),
  "@ai-sdk/cohere": createSimpleFactory(
    createCohere as unknown as (options: Record<string, unknown>) => unknown,
  ),
  "@ai-sdk/deepinfra": createSimpleFactory(
    createDeepInfra as unknown as (options: Record<string, unknown>) => unknown,
  ),
  "@ai-sdk/gateway": createSimpleFactory(
    createGateway as unknown as (options: Record<string, unknown>) => unknown,
  ),
  "@ai-sdk/google": createSimpleFactory(
    createGoogleGenerativeAI as unknown as (options: Record<string, unknown>) => unknown,
  ),
  "@ai-sdk/google-vertex": createVertexFactory,
  "@ai-sdk/google-vertex/anthropic": createVertexAnthropicFactory,
  "@ai-sdk/groq": createSimpleFactory(
    createGroq as unknown as (options: Record<string, unknown>) => unknown,
  ),
  "@ai-sdk/mistral": createSimpleFactory(
    createMistral as unknown as (options: Record<string, unknown>) => unknown,
  ),
  "@ai-sdk/openai": createSimpleFactory(
    createOpenAI as unknown as (options: Record<string, unknown>) => unknown,
  ),
  "@ai-sdk/openai-compatible": createSimpleFactory(
    createOpenAICompatible as unknown as (options: Record<string, unknown>) => unknown,
  ),
  "@ai-sdk/perplexity": createSimpleFactory(
    createPerplexity as unknown as (options: Record<string, unknown>) => unknown,
  ),
  "@ai-sdk/togetherai": createSimpleFactory(
    createTogetherAI as unknown as (options: Record<string, unknown>) => unknown,
  ),
  "@ai-sdk/vercel": createSimpleFactory(
    createVercel as unknown as (options: Record<string, unknown>) => unknown,
  ),
  "@ai-sdk/xai": createSimpleFactory(
    createXai as unknown as (options: Record<string, unknown>) => unknown,
  ),
  "@gitlab/gitlab-ai-provider": createGitLabFactory,
  "@jerome-benoit/sap-ai-provider-v2": createSapFactory,
  "@openrouter/ai-sdk-provider": createSimpleFactory(
    createOpenRouter as unknown as (options: Record<string, unknown>) => unknown,
  ),
  "ai-gateway-provider": createCloudflareAiGatewayFactory,
  "venice-ai-sdk-provider": createVeniceFactory,
};

export function createProviderFromNpm(input: ProviderFactoryInput): ProviderInstance {
  const factory = FACTORIES[input.npm];
  if (!factory) {
    throw new Error(`unsupported provider npm package '${input.npm}'`);
  }
  return factory(input);
}
