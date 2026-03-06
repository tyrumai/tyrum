import { ModelConfigDeleteConflictResponse, ModelConfigDeleteResponse } from "@tyrum/schemas";
import { z } from "zod";
import { validateOrThrow } from "./shared.js";

export type ParsedModelConfigDeleteResponse =
  | z.output<typeof ModelConfigDeleteResponse>
  | z.output<typeof ModelConfigDeleteConflictResponse>;

export async function parseModelConfigDeleteResponse(
  response: Response,
  input: {
    conflictContext: string;
    responseContext: string;
  },
): Promise<ParsedModelConfigDeleteResponse> {
  const body = (await response.json().catch(() => undefined)) as unknown;
  if (response.status === 409) {
    return validateOrThrow(ModelConfigDeleteConflictResponse, body, input.conflictContext);
  }
  return validateOrThrow(ModelConfigDeleteResponse, body, input.responseContext);
}
