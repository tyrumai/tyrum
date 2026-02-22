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
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { Provider } from "ai";

const FACTORIES: Record<string, (options: Record<string, unknown>) => Provider> = {
  "@ai-sdk/amazon-bedrock": createAmazonBedrock as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/anthropic": createAnthropic as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/azure": createAzure as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/cerebras": createCerebras as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/cohere": createCohere as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/deepinfra": createDeepInfra as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/gateway": createGateway as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/google": createGoogleGenerativeAI as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/google-vertex": createVertex as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/google-vertex/anthropic": createVertexAnthropic as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/groq": createGroq as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/mistral": createMistral as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/openai": createOpenAI as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/openai-compatible": createOpenAICompatible as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/perplexity": createPerplexity as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/togetherai": createTogetherAI as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/vercel": createVercel as unknown as (options: Record<string, unknown>) => Provider,
  "@ai-sdk/xai": createXai as unknown as (options: Record<string, unknown>) => Provider,
  "@openrouter/ai-sdk-provider": createOpenRouter as unknown as (options: Record<string, unknown>) => Provider,
};

export function createProviderFromNpm(input: {
  npm: string;
  providerId: string;
  apiKey?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  options?: Record<string, unknown>;
}): Provider {
  const factory = FACTORIES[input.npm];
  if (!factory) {
    throw new Error(`unsupported provider npm package '${input.npm}'`);
  }

  const mergedHeaders = (() => {
    const fromOptions = input.options?.["headers"];
    const fromOptionsHeaders =
      fromOptions && typeof fromOptions === "object" ? (fromOptions as Record<string, string>) : undefined;
    if (!fromOptionsHeaders && !input.headers) return undefined;
    return Object.assign({}, fromOptionsHeaders, input.headers);
  })();

  const options: Record<string, unknown> = Object.assign(
    {},
    input.options,
    input.apiKey ? { apiKey: input.apiKey } : undefined,
    input.baseURL ? { baseURL: input.baseURL } : undefined,
    mergedHeaders ? { headers: mergedHeaders } : undefined,
    input.fetchImpl ? { fetch: input.fetchImpl } : undefined,
  );

  if (input.npm === "@ai-sdk/openai-compatible") {
    options["name"] = input.providerId;
  }

  return factory(options);
}
