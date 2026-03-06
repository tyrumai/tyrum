declare module "@gitlab/gitlab-ai-provider" {
  export function createGitLab(options: Record<string, unknown>): unknown;
}

declare module "@jerome-benoit/sap-ai-provider-v2" {
  export function createSAPAIProvider(options: Record<string, unknown>): unknown;
}

declare module "ai-gateway-provider" {
  export function createAiGateway(options: Record<string, unknown>): (provider: unknown) => unknown;
}

declare module "ai-gateway-provider/providers/unified" {
  export function createUnified(options: Record<string, unknown>): {
    languageModel(modelId: string): unknown;
  };
}

declare module "venice-ai-sdk-provider" {
  export function createVenice(options: Record<string, unknown>): unknown;
}
