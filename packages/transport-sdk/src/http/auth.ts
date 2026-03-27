import {
  AuthProfile,
  AuthProfileCreateRequest,
  AuthProfileCreateResponse,
  AuthProfileDisableRequest,
  AuthProfileEnableRequest,
  AuthProfileListResponse,
  AuthProfileStatus,
  AuthProfileUpdateRequest,
  ConversationProviderPinClearResponse,
  ConversationProviderPinListResponse,
  ConversationProviderPinSetRequest,
  ConversationProviderPinSetResponse,
} from "@tyrum/contracts";
import { z } from "zod";
import {
  HttpTransport,
  NonEmptyString,
  validateOrThrow,
  type TyrumRequestOptions,
} from "./shared.js";

const AuthProfileListQuery = z
  .object({
    provider_key: NonEmptyString.optional(),
    status: AuthProfileStatus.optional(),
  })
  .strict();

const AuthPinListQuery = z
  .object({
    conversation_id: NonEmptyString.optional(),
    provider_key: NonEmptyString.optional(),
  })
  .strict();

const AuthProfileMutateResponse = z
  .object({
    status: z.literal("ok"),
    profile: AuthProfile,
  })
  .strict();

export type AuthPinSetResult =
  | z.output<typeof ConversationProviderPinSetResponse>
  | z.output<typeof ConversationProviderPinClearResponse>;
export type AuthProfileListResult = z.output<typeof AuthProfileListResponse>;
export type AuthProfileCreateInput = z.input<typeof AuthProfileCreateRequest>;
export type AuthProfileCreateResult = z.output<typeof AuthProfileCreateResponse>;
export type AuthProfileUpdateInput = z.input<typeof AuthProfileUpdateRequest>;
export type AuthProfileDisableInput = z.input<typeof AuthProfileDisableRequest>;
export type AuthProfileEnableInput = z.input<typeof AuthProfileEnableRequest>;
export type AuthPinSetInput = z.input<typeof ConversationProviderPinSetRequest>;
export type AuthPinListResult = z.output<typeof ConversationProviderPinListResponse>;

const AuthProfilePathId = z.string().trim().min(1);

export interface AuthProfilesApi {
  list(
    query?: z.input<typeof AuthProfileListQuery>,
    options?: TyrumRequestOptions,
  ): Promise<AuthProfileListResult>;
  create(
    input: AuthProfileCreateInput,
    options?: TyrumRequestOptions,
  ): Promise<AuthProfileCreateResult>;
  update(
    profileId: string,
    input: AuthProfileUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<z.infer<typeof AuthProfileMutateResponse>>;
  disable(
    profileId: string,
    input: AuthProfileDisableInput,
    options?: TyrumRequestOptions,
  ): Promise<z.infer<typeof AuthProfileMutateResponse>>;
  enable(
    profileId: string,
    input: AuthProfileEnableInput,
    options?: TyrumRequestOptions,
  ): Promise<z.infer<typeof AuthProfileMutateResponse>>;
}

export interface AuthPinsApi {
  list(
    query?: z.input<typeof AuthPinListQuery>,
    options?: TyrumRequestOptions,
  ): Promise<AuthPinListResult>;
  set(input: AuthPinSetInput, options?: TyrumRequestOptions): Promise<AuthPinSetResult>;
}

export function createAuthProfilesApi(transport: HttpTransport): AuthProfilesApi {
  return {
    async list(query, options) {
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
        signal: options?.signal,
      });
    },

    async create(input, options) {
      const body = validateOrThrow(AuthProfileCreateRequest, input, "auth profile create request");
      return await transport.request({
        method: "POST",
        path: "/auth/profiles",
        body,
        response: AuthProfileCreateResponse,
        expectedStatus: 201,
        signal: options?.signal,
      });
    },

    async update(profileId, input, options) {
      const parsedProfileId = validateOrThrow(AuthProfilePathId, profileId, "auth profile id");
      const body = validateOrThrow(AuthProfileUpdateRequest, input, "auth profile update request");
      return await transport.request({
        method: "PATCH",
        path: `/auth/profiles/${encodeURIComponent(parsedProfileId)}`,
        body,
        response: AuthProfileMutateResponse,
        signal: options?.signal,
      });
    },

    async disable(profileId, input, options) {
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
        signal: options?.signal,
      });
    },

    async enable(profileId, input, options) {
      const parsedProfileId = validateOrThrow(AuthProfilePathId, profileId, "auth profile id");
      const body = validateOrThrow(AuthProfileEnableRequest, input, "auth profile enable request");
      return await transport.request({
        method: "POST",
        path: `/auth/profiles/${encodeURIComponent(parsedProfileId)}/enable`,
        body,
        response: AuthProfileMutateResponse,
        signal: options?.signal,
      });
    },
  };
}

export function createAuthPinsApi(transport: HttpTransport): AuthPinsApi {
  return {
    async list(query, options) {
      const parsedQuery = validateOrThrow(AuthPinListQuery, query ?? {}, "auth pin list query");
      return await transport.request({
        method: "GET",
        path: "/auth/pins",
        query: parsedQuery,
        response: ConversationProviderPinListResponse,
        signal: options?.signal,
      });
    },

    async set(input, options) {
      const body = validateOrThrow(
        ConversationProviderPinSetRequest,
        input,
        "auth pin set request",
      );

      if (body.auth_profile_key === null) {
        return await transport.request({
          method: "POST",
          path: "/auth/pins",
          body,
          response: ConversationProviderPinClearResponse,
          signal: options?.signal,
        });
      }

      return await transport.request({
        method: "POST",
        path: "/auth/pins",
        body,
        response: ConversationProviderPinSetResponse,
        expectedStatus: 201,
        signal: options?.signal,
      });
    },
  };
}
