import type { ModelsDevCatalog } from "@tyrum/schemas";

type MethodType = "api_key" | "oauth" | "token";
type FieldInput = "text" | "password" | "boolean";
type FieldKind = "config" | "secret";

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

const SUPPORTED_PROVIDER_SPECS: Record<string, ProviderRegistrySpec> = {
  anthropic: {
    provider_key: "anthropic",
    supported: true,
    methods: [
      {
        method_key: "api_key",
        label: "API key",
        type: "api_key",
        fields: [
          {
            key: "api_key",
            label: "API key",
            description: null,
            kind: "secret",
            input: "password",
            required: true,
          },
          {
            key: "baseURL",
            label: "Base URL",
            description: "Optional proxy or custom endpoint.",
            kind: "config",
            input: "text",
            required: false,
          },
        ],
      },
    ],
  },
  openai: {
    provider_key: "openai",
    supported: true,
    methods: [
      {
        method_key: "api_key",
        label: "API key",
        type: "api_key",
        fields: [
          {
            key: "api_key",
            label: "API key",
            description: null,
            kind: "secret",
            input: "password",
            required: true,
          },
          {
            key: "baseURL",
            label: "Base URL",
            description: "Optional proxy or custom endpoint.",
            kind: "config",
            input: "text",
            required: false,
          },
        ],
      },
    ],
  },
  google: {
    provider_key: "google",
    supported: true,
    methods: [
      {
        method_key: "api_key",
        label: "API key",
        type: "api_key",
        fields: [
          {
            key: "api_key",
            label: "API key",
            description: null,
            kind: "secret",
            input: "password",
            required: true,
          },
          {
            key: "baseURL",
            label: "Base URL",
            description: "Optional proxy or custom endpoint.",
            kind: "config",
            input: "text",
            required: false,
          },
        ],
      },
    ],
  },
  openrouter: {
    provider_key: "openrouter",
    supported: true,
    methods: [
      {
        method_key: "api_key",
        label: "API key",
        type: "api_key",
        fields: [
          {
            key: "api_key",
            label: "API key",
            description: null,
            kind: "secret",
            input: "password",
            required: true,
          },
        ],
      },
    ],
  },
  minimax: {
    provider_key: "minimax",
    supported: true,
    methods: [
      {
        method_key: "api_key",
        label: "API key",
        type: "api_key",
        fields: [
          {
            key: "api_key",
            label: "API key",
            description: null,
            kind: "secret",
            input: "password",
            required: true,
          },
          {
            key: "baseURL",
            label: "Base URL",
            description: "Optional proxy or custom endpoint.",
            kind: "config",
            input: "text",
            required: false,
          },
        ],
      },
    ],
  },
  moonshotai: {
    provider_key: "moonshotai",
    supported: true,
    methods: [
      {
        method_key: "api_key",
        label: "API key",
        type: "api_key",
        fields: [
          {
            key: "api_key",
            label: "API key",
            description: null,
            kind: "secret",
            input: "password",
            required: true,
          },
          {
            key: "baseURL",
            label: "Base URL",
            description: "Optional proxy or custom endpoint.",
            kind: "config",
            input: "text",
            required: false,
          },
        ],
      },
    ],
  },
  zai: {
    provider_key: "zai",
    supported: true,
    methods: [
      {
        method_key: "api_key",
        label: "API key",
        type: "api_key",
        fields: [
          {
            key: "api_key",
            label: "API key",
            description: null,
            kind: "secret",
            input: "password",
            required: true,
          },
          {
            key: "baseURL",
            label: "Base URL",
            description: "Optional proxy or custom endpoint.",
            kind: "config",
            input: "text",
            required: false,
          },
        ],
      },
    ],
  },
  azure: {
    provider_key: "azure",
    supported: true,
    methods: [
      {
        method_key: "api_key",
        label: "API key",
        type: "api_key",
        fields: [
          {
            key: "api_key",
            label: "API key",
            description: null,
            kind: "secret",
            input: "password",
            required: true,
          },
          {
            key: "resourceName",
            label: "Resource name",
            description: "Set either resource name or base URL.",
            kind: "config",
            input: "text",
            required: false,
          },
          {
            key: "baseURL",
            label: "Base URL",
            description: "Set either base URL or resource name.",
            kind: "config",
            input: "text",
            required: false,
          },
          {
            key: "apiVersion",
            label: "API version",
            description: null,
            kind: "config",
            input: "text",
            required: false,
          },
          {
            key: "useDeploymentBasedUrls",
            label: "Use deployment URLs",
            description: null,
            kind: "config",
            input: "boolean",
            required: false,
          },
        ],
      },
    ],
  },
  "amazon-bedrock": {
    provider_key: "amazon-bedrock",
    supported: true,
    methods: [
      {
        method_key: "aws_keys",
        label: "AWS access keys",
        type: "api_key",
        fields: [
          {
            key: "region",
            label: "Region",
            description: null,
            kind: "config",
            input: "text",
            required: true,
          },
          {
            key: "accessKeyId",
            label: "Access key ID",
            description: null,
            kind: "secret",
            input: "password",
            required: true,
          },
          {
            key: "secretAccessKey",
            label: "Secret access key",
            description: null,
            kind: "secret",
            input: "password",
            required: true,
          },
          {
            key: "sessionToken",
            label: "Session token",
            description: null,
            kind: "secret",
            input: "password",
            required: false,
          },
          {
            key: "baseURL",
            label: "Base URL",
            description: null,
            kind: "config",
            input: "text",
            required: false,
          },
        ],
      },
      {
        method_key: "bearer_token",
        label: "Bearer token",
        type: "token",
        fields: [
          {
            key: "region",
            label: "Region",
            description: null,
            kind: "config",
            input: "text",
            required: true,
          },
          {
            key: "token",
            label: "Bearer token",
            description: null,
            kind: "secret",
            input: "password",
            required: true,
          },
          {
            key: "baseURL",
            label: "Base URL",
            description: null,
            kind: "config",
            input: "text",
            required: false,
          },
        ],
      },
    ],
  },
  groq: {
    provider_key: "groq",
    supported: true,
    methods: [
      {
        method_key: "api_key",
        label: "API key",
        type: "api_key",
        fields: [
          {
            key: "api_key",
            label: "API key",
            description: null,
            kind: "secret",
            input: "password",
            required: true,
          },
        ],
      },
    ],
  },
  cerebras: {
    provider_key: "cerebras",
    supported: true,
    methods: [
      {
        method_key: "api_key",
        label: "API key",
        type: "api_key",
        fields: [
          {
            key: "api_key",
            label: "API key",
            description: null,
            kind: "secret",
            input: "password",
            required: true,
          },
        ],
      },
    ],
  },
};

export function buildManagedProviderSecretKey(accountKey: string, slotKey: string): string {
  return `${MANAGED_PROVIDER_SECRET_PREFIX}${accountKey}:${slotKey}`;
}

export function isManagedProviderSecretKey(secretKey: string): boolean {
  return secretKey.startsWith(MANAGED_PROVIDER_SECRET_PREFIX);
}

export function listProviderRegistrySpecs(
  catalog: ModelsDevCatalog | Record<string, unknown>,
): ProviderRegistrySpec[] {
  const catalogProviders = Object.values(catalog as Record<string, unknown>)
    .filter(
      (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
    )
    .map((provider) => {
      const providerKey = typeof provider["id"] === "string" ? provider["id"] : "";
      const supported = SUPPORTED_PROVIDER_SPECS[providerKey];
      return {
        provider_key: providerKey,
        supported: Boolean(supported),
        name:
          supported?.name?.trim() ||
          (typeof provider["name"] === "string" ? provider["name"] : providerKey),
        doc:
          supported?.doc ??
          (typeof provider["doc"] === "string" && provider["doc"].trim().length > 0
            ? provider["doc"].trim()
            : null),
        methods: supported?.methods ?? [],
      } satisfies ProviderRegistrySpec;
    });

  const seen = new Set(catalogProviders.map((provider) => provider.provider_key));
  const missingSupported = Object.values(SUPPORTED_PROVIDER_SPECS)
    .filter((provider) => !seen.has(provider.provider_key))
    .map((provider) => ({
      provider_key: provider.provider_key,
      supported: provider.supported,
      name: provider.name ?? provider.provider_key,
      doc: provider.doc ?? null,
      methods: provider.methods,
    }));

  return [...catalogProviders, ...missingSupported].sort((a, b) =>
    a.provider_key.localeCompare(b.provider_key),
  );
}

export function getProviderRegistrySpec(providerKey: string): ProviderRegistrySpec | undefined {
  return SUPPORTED_PROVIDER_SPECS[providerKey];
}

export function getProviderMethodSpec(
  providerKey: string,
  methodKey: string,
): ProviderMethodSpec | undefined {
  return getProviderRegistrySpec(providerKey)?.methods.find(
    (method) => method.method_key === methodKey,
  );
}
