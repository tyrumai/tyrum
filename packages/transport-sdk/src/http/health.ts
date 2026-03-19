import { z } from "zod";
import { HttpTransport, type TyrumRequestOptions } from "./shared.js";

const HealthResponse = z
  .object({
    status: z.literal("ok"),
    is_exposed: z.boolean(),
  })
  .strict();

export type HealthResponse = z.infer<typeof HealthResponse>;

export interface HealthApi {
  get(options?: TyrumRequestOptions): Promise<HealthResponse>;
}

export function createHealthApi(transport: HttpTransport): HealthApi {
  return {
    async get(options) {
      return await transport.request({
        method: "GET",
        path: "/healthz",
        response: HealthResponse,
        signal: options?.signal,
      });
    },
  };
}
