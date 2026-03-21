// GENERATED: pnpm api:generate

import type { HealthApi } from "../health.js";
import { HttpTransport } from "../shared.js";
import { z } from "zod";

const HealthResponse = z
  .object({
    status: z.literal("ok"),
    is_exposed: z.boolean(),
  })
  .strict();
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
