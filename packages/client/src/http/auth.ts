import {
  AgentId,
  AuthProfile,
  AuthProfileCreateRequest,
  AuthProfileCreateResponse,
  AuthProfileDisableRequest,
  AuthProfileEnableRequest,
  AuthProfileListResponse,
  AuthProfileStatus,
  AuthProfileUpdateRequest,
  SessionProviderPin,
  SessionProviderPinListResponse,
  SessionProviderPinSetRequest,
} from "@tyrum/schemas";
import { z } from "zod";
import { HttpTransport, validateOrThrow } from "./shared.js";

const NonEmptyString = z.string().trim().min(1);

const AuthProfileListQuery = z
  .object({
    agent_id: AgentId.optional(),
    provider: NonEmptyString.optional(),
    status: AuthProfileStatus.optional(),
  })
  .strict();

const AuthPinListQuery = z
  .object({
    agent_id: AgentId.optional(),
    session_id: NonEmptyString.optional(),
    provider: NonEmptyString.optional(),
  })
  .strict();

const AuthProfileMutateResponse = z
  .object({
    status: z.literal("ok"),
    profile: AuthProfile,
  })
  .strict();

const AuthPinSetPinResponse = z
  .object({
    status: z.literal("ok"),
    pin: SessionProviderPin,
  })
  .strict();

const AuthPinSetClearResponse = z
  .object({
    status: z.literal("ok"),
    cleared: z.boolean(),
  })
  .strict();

export type AuthPinSetResult =
  | z.infer<typeof AuthPinSetPinResponse>
  | z.infer<typeof AuthPinSetClearResponse>;
export type AuthProfileListResult = z.output<typeof AuthProfileListResponse>;
export type AuthProfileCreateInput = z.input<typeof AuthProfileCreateRequest>;
export type AuthProfileCreateResult = z.output<typeof AuthProfileCreateResponse>;
export type AuthProfileUpdateInput = z.input<typeof AuthProfileUpdateRequest>;
export type AuthProfileDisableInput = z.input<typeof AuthProfileDisableRequest>;
export type AuthProfileEnableInput = z.input<typeof AuthProfileEnableRequest>;
export type AuthPinSetInput = z.input<typeof SessionProviderPinSetRequest>;
export type AuthPinListResult = z.output<typeof SessionProviderPinListResponse>;

const AuthProfilePathId = z.string().trim().min(1);

export interface AuthProfilesApi {
  list(query?: z.input<typeof AuthProfileListQuery>): Promise<AuthProfileListResult>;
  create(input: AuthProfileCreateInput): Promise<AuthProfileCreateResult>;
  update(
    profileId: string,
    input: AuthProfileUpdateInput,
  ): Promise<z.infer<typeof AuthProfileMutateResponse>>;
  disable(
    profileId: string,
    input: AuthProfileDisableInput,
  ): Promise<z.infer<typeof AuthProfileMutateResponse>>;
  enable(
    profileId: string,
    input: AuthProfileEnableInput,
  ): Promise<z.infer<typeof AuthProfileMutateResponse>>;
}

export interface AuthPinsApi {
  list(query?: z.input<typeof AuthPinListQuery>): Promise<AuthPinListResult>;
  set(input: AuthPinSetInput): Promise<AuthPinSetResult>;
}

export function createAuthProfilesApi(transport: HttpTransport): AuthProfilesApi {
  return {
    async list(query) {
      const parsedQuery = validateOrThrow(
        AuthProfileListQuery,
        query ?? {},
        "auth profile list query",
      );
      return await transport.request({
        method: "GET",
        path: "/auth/profiles",
        query: parsedQuery,
        response: AuthProfileListResponse,
      });
    },

    async create(input) {
      const body = validateOrThrow(AuthProfileCreateRequest, input, "auth profile create request");
      return await transport.request({
        method: "POST",
        path: "/auth/profiles",
        body,
        response: AuthProfileCreateResponse,
        expectedStatus: 201,
      });
    },

    async update(profileId, input) {
      const parsedProfileId = validateOrThrow(AuthProfilePathId, profileId, "auth profile id");
      const body = validateOrThrow(AuthProfileUpdateRequest, input, "auth profile update request");
      return await transport.request({
        method: "PATCH",
        path: `/auth/profiles/${encodeURIComponent(parsedProfileId)}`,
        body,
        response: AuthProfileMutateResponse,
      });
    },

    async disable(profileId, input) {
      const parsedProfileId = validateOrThrow(AuthProfilePathId, profileId, "auth profile id");
      const body = validateOrThrow(
        AuthProfileDisableRequest,
        input,
        "auth profile disable request",
      );
      return await transport.request({
        method: "POST",
        path: `/auth/profiles/${encodeURIComponent(parsedProfileId)}/disable`,
        body,
        response: AuthProfileMutateResponse,
      });
    },

    async enable(profileId, input) {
      const parsedProfileId = validateOrThrow(AuthProfilePathId, profileId, "auth profile id");
      const body = validateOrThrow(AuthProfileEnableRequest, input, "auth profile enable request");
      return await transport.request({
        method: "POST",
        path: `/auth/profiles/${encodeURIComponent(parsedProfileId)}/enable`,
        body,
        response: AuthProfileMutateResponse,
      });
    },
  };
}

export function createAuthPinsApi(transport: HttpTransport): AuthPinsApi {
  return {
    async list(query) {
      const parsedQuery = validateOrThrow(AuthPinListQuery, query ?? {}, "auth pin list query");
      return await transport.request({
        method: "GET",
        path: "/auth/pins",
        query: parsedQuery,
        response: SessionProviderPinListResponse,
      });
    },

    async set(input) {
      const body = validateOrThrow(SessionProviderPinSetRequest, input, "auth pin set request");

      if (body.profile_id === null) {
        return await transport.request({
          method: "POST",
          path: "/auth/pins",
          body,
          response: AuthPinSetClearResponse,
        });
      }

      return await transport.request({
        method: "POST",
        path: "/auth/pins",
        body,
        response: AuthPinSetPinResponse,
        expectedStatus: 201,
      });
    },
  };
}
