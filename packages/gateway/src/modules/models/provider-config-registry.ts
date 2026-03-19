import type { ModelsDevCatalog } from "@tyrum/contracts";

type MethodType = "api_key" | "oauth" | "token";
type FieldInput = "text" | "password" | "boolean";
type FieldKind = "config" | "secret";

type CatalogProvider = Record<string, unknown>;

export type ProviderConfigFieldSpec = {
  key: string;
  label: string;
  description: string | null;
  kind: FieldKind;
  input: FieldInput;
  required: boolean;
};

export type ProviderMethodSpec = {
  method_key: string;
  label: string;
  type: MethodType;
  fields: ProviderConfigFieldSpec[];
};

export type ProviderRegistrySpec = {
  provider_key: string;
  supported: boolean;
  name?: string;
  doc?: string | null;
  methods: ProviderMethodSpec[];
};

export const MANAGED_PROVIDER_SECRET_PREFIX = "provider-account:";

const SIMPLE_API_KEY_BASE_URL_NPMS = new Set([
  "@ai-sdk/anthropic",
  "@ai-sdk/cohere",
  "@ai-sdk/deepinfra",
  "@ai-sdk/gateway",
  "@ai-sdk/google",
  "@ai-sdk/mistral",
  "@ai-sdk/openai",
  "@ai-sdk/openai-compatible",
  "@ai-sdk/perplexity",
  "@ai-sdk/togetherai",
  "@ai-sdk/vercel",
  "@ai-sdk/xai",
]);

const SIMPLE_API_KEY_NPMS = new Set([
  "@ai-sdk/cerebras",
  "@ai-sdk/groq",
  "@openrouter/ai-sdk-provider",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function trimToUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function field(
  key: string,
  label: string,
  options: {
    kind: FieldKind;
    input: FieldInput;
    required: boolean;
    description?: string | null;
  },
): ProviderConfigFieldSpec {
  return {
    key,
    label,
    description: options.description ?? null,
    kind: options.kind,
    input: options.input,
    required: options.required,
  };
}

function method(
  methodKey: string,
  label: string,
  type: MethodType,
  fields: ProviderConfigFieldSpec[],
): ProviderMethodSpec {
  return {
    method_key: methodKey,
    label,
    type,
    fields: dedupeFields(fields),
  };
}

function dedupeFields(fields: ProviderConfigFieldSpec[]): ProviderConfigFieldSpec[] {
  const seen = new Set<string>();
  const output: ProviderConfigFieldSpec[] = [];
  for (const candidate of fields) {
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    output.push(candidate);
  }
  return output;
}

function buildSimpleApiKeyMethod(input?: {
  includeBaseURL?: boolean;
  apiLabel?: string;
  extraFields?: ProviderConfigFieldSpec[];
}): ProviderMethodSpec {
  return method("api_key", input?.apiLabel ?? "API key", "api_key", [
    field("api_key", input?.apiLabel ?? "API key", {
      kind: "secret",
      input: "password",
      required: true,
    }),
    ...(input?.includeBaseURL
      ? [
          field("baseURL", "Base URL", {
            kind: "config",
            input: "text",
            required: false,
            description: "Optional proxy or custom endpoint.",
          }),
        ]
      : []),
    ...(input?.extraFields ?? []),
  ]);
}

function buildAzureMethod(): ProviderMethodSpec {
  return method("api_key", "API key", "api_key", [
    field("api_key", "API key", { kind: "secret", input: "password", required: true }),
    field("resourceName", "Resource name", {
      kind: "config",
      input: "text",
      required: false,
      description: "Set either resource name or base URL.",
    }),
    field("baseURL", "Base URL", {
      kind: "config",
      input: "text",
      required: false,
      description: "Set either base URL or resource name.",
    }),
    field("apiVersion", "API version", {
      kind: "config",
      input: "text",
      required: false,
    }),
    field("useDeploymentBasedUrls", "Use deployment URLs", {
      kind: "config",
      input: "boolean",
      required: false,
    }),
  ]);
}

function buildAmazonBedrockMethods(): ProviderMethodSpec[] {
  return [
    method("aws_keys", "AWS access keys", "api_key", [
      field("region", "Region", { kind: "config", input: "text", required: true }),
      field("accessKeyId", "Access key ID", {
        kind: "secret",
        input: "password",
        required: true,
      }),
      field("secretAccessKey", "Secret access key", {
        kind: "secret",
        input: "password",
        required: true,
      }),
      field("sessionToken", "Session token", {
        kind: "secret",
        input: "password",
        required: false,
      }),
      field("baseURL", "Base URL", {
        kind: "config",
        input: "text",
        required: false,
      }),
    ]),
    method("bearer_token", "Bearer token", "token", [
      field("region", "Region", { kind: "config", input: "text", required: true }),
      field("token", "Bearer token", {
        kind: "secret",
        input: "password",
        required: true,
      }),
      field("baseURL", "Base URL", {
        kind: "config",
        input: "text",
        required: false,
      }),
    ]),
  ];
}

function buildVertexMethod(): ProviderMethodSpec {
  return method("google_cloud", "Google Cloud", "api_key", [
    field("project", "Project", {
      kind: "config",
      input: "text",
      required: true,
    }),
    field("location", "Location", {
      kind: "config",
      input: "text",
      required: true,
    }),
    field("baseURL", "Base URL", {
      kind: "config",
      input: "text",
      required: false,
      description: "Optional custom endpoint override.",
    }),
    field("api_key", "API key", {
      kind: "secret",
      input: "password",
      required: false,
      description: "Optional project API key. Service-account credentials are preferred.",
    }),
    field("googleCredentialsJson", "Service account JSON", {
      kind: "secret",
      input: "password",
      required: false,
      description: "Paste the Google service-account JSON used to authenticate Vertex requests.",
    }),
  ]);
}

function buildCloudflareAiGatewayMethod(): ProviderMethodSpec {
  return method("api_key", "API token", "api_key", [
    field("accountId", "Account ID", {
      kind: "config",
      input: "text",
      required: true,
    }),
    field("gateway", "Gateway ID", {
      kind: "config",
      input: "text",
      required: true,
    }),
    field("api_key", "API token", {
      kind: "secret",
      input: "password",
      required: false,
      description: "Optional when the AI Gateway is not protected by a Cloudflare token.",
    }),
  ]);
}

function buildGitLabMethod(): ProviderMethodSpec {
  return method("api_key", "Token", "api_key", [
    field("api_key", "Token", {
      kind: "secret",
      input: "password",
      required: true,
    }),
    field("instanceUrl", "Instance URL", {
      kind: "config",
      input: "text",
      required: false,
      description: "Optional self-hosted GitLab URL. Defaults to https://gitlab.com.",
    }),
    field("aiGatewayUrl", "AI Gateway URL", {
      kind: "config",
      input: "text",
      required: false,
    }),
    field("refreshToken", "Refresh token", {
      kind: "secret",
      input: "password",
      required: false,
    }),
    field("clientId", "OAuth client ID", {
      kind: "config",
      input: "text",
      required: false,
    }),
    field("redirectUri", "OAuth redirect URI", {
      kind: "config",
      input: "text",
      required: false,
    }),
  ]);
}

function buildSapMethod(): ProviderMethodSpec {
  return method("service_key", "Service key", "api_key", [
    field("service_key", "Service key JSON", {
      kind: "secret",
      input: "password",
      required: true,
      description: "Paste the SAP AI Core service key JSON.",
    }),
    field("api", "API mode", {
      kind: "config",
      input: "text",
      required: false,
      description: "Optional. Set to orchestration or foundation-models.",
    }),
    field("resourceGroup", "Resource group", {
      kind: "config",
      input: "text",
      required: false,
    }),
    field("deploymentId", "Deployment ID", {
      kind: "config",
      input: "text",
      required: false,
    }),
  ]);
}

function humanizeEnvVar(key: string): string {
  return key
    .toLowerCase()
    .split(/[_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function isSecretEnvVar(name: string): boolean {
  return /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|SERVICE_KEY)/i.test(name);
}

function extractTemplateVariables(raw: string | undefined): string[] {
  if (!raw) return [];
  const matches = raw.matchAll(/\$\{([A-Z0-9_]+)\}/g);
  const values = new Set<string>();
  for (const match of matches) {
    const value = match[1]?.trim();
    if (value) values.add(value);
  }
  return Array.from(values).toSorted((a, b) => a.localeCompare(b));
}

function listProviderTemplateVariables(provider: CatalogProvider): string[] {
  const values = new Set<string>(extractTemplateVariables(trimToUndefined(provider["api"])));
  const models = asRecord(provider["models"]) ?? {};
  for (const model of Object.values(models)) {
    const providerOverride = asRecord(asRecord(model)?.["provider"]);
    const api = trimToUndefined(providerOverride?.["api"]);
    for (const variable of extractTemplateVariables(api)) {
      values.add(variable);
    }
  }
  return Array.from(values).toSorted((a, b) => a.localeCompare(b));
}

function buildTemplateFields(provider: CatalogProvider): ProviderConfigFieldSpec[] {
  return listProviderTemplateVariables(provider).map((name) =>
    field(name, humanizeEnvVar(name), {
      kind: isSecretEnvVar(name) ? "secret" : "config",
      input: isSecretEnvVar(name) ? "password" : "text",
      required: false,
      description: `Optional value for the catalog endpoint template variable ${name}.`,
    }),
  );
}

function buildMethodsForProvider(
  providerKey: string,
  provider: CatalogProvider,
): ProviderMethodSpec[] {
  const npm = trimToUndefined(provider["npm"]);
  const templateFields = buildTemplateFields(provider);

  switch (providerKey) {
    case "amazon-bedrock":
      return buildAmazonBedrockMethods();
    case "azure":
      return [buildAzureMethod()];
    case "google-vertex":
    case "google-vertex-anthropic":
      return [buildVertexMethod()];
    case "cloudflare-ai-gateway":
      return [buildCloudflareAiGatewayMethod()];
    case "gitlab":
      return [buildGitLabMethod()];
    case "sap-ai-core":
      return [buildSapMethod()];
    default:
      break;
  }

  if (!npm) return [];

  if (SIMPLE_API_KEY_BASE_URL_NPMS.has(npm)) {
    return [buildSimpleApiKeyMethod({ includeBaseURL: true, extraFields: templateFields })];
  }

  if (SIMPLE_API_KEY_NPMS.has(npm)) {
    return [buildSimpleApiKeyMethod({ includeBaseURL: false, extraFields: templateFields })];
  }

  if (npm === "@ai-sdk/azure") {
    return [buildAzureMethod()];
  }

  if (npm === "@ai-sdk/amazon-bedrock") {
    return buildAmazonBedrockMethods();
  }

  if (npm === "@ai-sdk/google-vertex" || npm === "@ai-sdk/google-vertex/anthropic") {
    return [buildVertexMethod()];
  }

  if (npm === "ai-gateway-provider") {
    return [buildCloudflareAiGatewayMethod()];
  }

  if (npm === "gitlab-ai-provider") {
    return [buildGitLabMethod()];
  }

  if (npm === "@jerome-benoit/sap-ai-provider-v2") {
    return [buildSapMethod()];
  }

  return [];
}

function toRegistrySpec(provider: CatalogProvider): ProviderRegistrySpec | undefined {
  const providerKey = trimToUndefined(provider["id"]);
  if (!providerKey) return undefined;

  const methods = buildMethodsForProvider(providerKey, provider);
  return {
    provider_key: providerKey,
    supported: methods.length > 0,
    name: trimToUndefined(provider["name"]) ?? providerKey,
    doc: trimToUndefined(provider["doc"]) ?? null,
    methods,
  };
}

export function buildManagedProviderSecretKey(accountKey: string, slotKey: string): string {
  return `${MANAGED_PROVIDER_SECRET_PREFIX}${accountKey}:${slotKey}`;
}

export function isManagedProviderSecretKey(secretKey: string): boolean {
  return secretKey.startsWith(MANAGED_PROVIDER_SECRET_PREFIX);
}

export function listProviderRegistrySpecs(
  catalog: ModelsDevCatalog | Record<string, unknown>,
): ProviderRegistrySpec[] {
  return Object.values(catalog as Record<string, unknown>)
    .map((value) => asRecord(value))
    .filter((value): value is CatalogProvider => Boolean(value))
    .map((provider) => toRegistrySpec(provider))
    .filter((provider): provider is ProviderRegistrySpec => Boolean(provider))
    .toSorted((left, right) => left.provider_key.localeCompare(right.provider_key));
}

export function findProviderMethodSpec(
  spec: ProviderRegistrySpec | undefined,
  methodKey: string,
): ProviderMethodSpec | undefined {
  return spec?.methods.find((providerMethod) => providerMethod.method_key === methodKey);
}
