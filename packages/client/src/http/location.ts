import { DateTimeSchema } from "@tyrum/schemas";
import { z } from "zod";
import {
  HttpTransport,
  NonEmptyString,
  type TyrumRequestOptions,
  validateOrThrow,
} from "./shared.js";

const Latitude = z.number().finite().min(-90).max(90);
const Longitude = z.number().finite().min(-180).max(180);
const RadiusMeters = z.number().finite().positive().max(100_000);
const PlaceSource = z.enum(["manual", "memory", "provider", "import"]);
const PlaceId = NonEmptyString;
const NodeId = NonEmptyString;
const ProviderKey = NonEmptyString;

const PlaceTags = z.array(NonEmptyString).default([]);

const LocationPlace = z
  .object({
    place_id: PlaceId,
    name: NonEmptyString,
    latitude: Latitude,
    longitude: Longitude,
    radius_m: RadiusMeters,
    tags: PlaceTags,
    source: PlaceSource.default("manual"),
    created_at: DateTimeSchema,
    updated_at: DateTimeSchema,
  })
  .strict();

const LocationProfile = z
  .object({
    primary_node_id: NodeId.nullable(),
    poi_provider_key: ProviderKey.nullable().optional(),
    updated_at: DateTimeSchema.nullable().optional(),
  })
  .strict();

const LocationPlaceListResponse = z
  .object({
    status: z.literal("ok"),
    places: z.array(LocationPlace),
  })
  .strict();

const LocationPlaceMutateResponse = z
  .object({
    status: z.literal("ok"),
    place: LocationPlace,
  })
  .strict();

const LocationPlaceDeleteResponse = z
  .object({
    status: z.literal("ok"),
    place_id: PlaceId,
    deleted: z.literal(true),
  })
  .strict();

const LocationProfileResponse = z
  .object({
    status: z.literal("ok"),
    profile: LocationProfile,
  })
  .strict();

const LocationPlaceCreateRequest = z
  .object({
    name: NonEmptyString,
    latitude: Latitude,
    longitude: Longitude,
    radius_m: RadiusMeters,
    tags: PlaceTags.optional(),
    source: PlaceSource.optional(),
  })
  .strict();

const LocationPlaceUpdateRequest = LocationPlaceCreateRequest.partial().superRefine(
  (value, ctx) => {
    if (Object.keys(value).length > 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "location place update request must include at least one field",
      path: [],
    });
  },
);

const LocationProfileUpdateRequest = z
  .object({
    primary_node_id: NodeId.nullable().optional(),
    poi_provider_key: ProviderKey.nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length > 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "location profile update request must include at least one field",
      path: [],
    });
  });

export type LocationPlace = z.output<typeof LocationPlace>;
export type LocationProfile = z.output<typeof LocationProfile>;
export type LocationPlaceListResult = z.output<typeof LocationPlaceListResponse>;
export type LocationPlaceMutateResult = z.output<typeof LocationPlaceMutateResponse>;
export type LocationPlaceDeleteResult = z.output<typeof LocationPlaceDeleteResponse>;
export type LocationProfileResult = z.output<typeof LocationProfileResponse>;
export type LocationPlaceCreateInput = z.input<typeof LocationPlaceCreateRequest>;
export type LocationPlaceUpdateInput = z.input<typeof LocationPlaceUpdateRequest>;
export type LocationProfileUpdateInput = z.input<typeof LocationProfileUpdateRequest>;

export interface LocationApi {
  listPlaces(options?: TyrumRequestOptions): Promise<LocationPlaceListResult>;
  createPlace(
    input: LocationPlaceCreateInput,
    options?: TyrumRequestOptions,
  ): Promise<LocationPlaceMutateResult>;
  updatePlace(
    placeId: string,
    input: LocationPlaceUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<LocationPlaceMutateResult>;
  deletePlace(placeId: string, options?: TyrumRequestOptions): Promise<LocationPlaceDeleteResult>;
  getProfile(options?: TyrumRequestOptions): Promise<LocationProfileResult>;
  updateProfile(
    input: LocationProfileUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<LocationProfileResult>;
}

export function createLocationApi(transport: HttpTransport): LocationApi {
  return {
    async listPlaces(options) {
      return await transport.request({
        method: "GET",
        path: "/location/places",
        response: LocationPlaceListResponse,
        signal: options?.signal,
      });
    },

    async createPlace(input, options) {
      const body = validateOrThrow(
        LocationPlaceCreateRequest,
        input,
        "location place create request",
      );
      return await transport.request({
        method: "POST",
        path: "/location/places",
        body,
        response: LocationPlaceMutateResponse,
        expectedStatus: 201,
        signal: options?.signal,
      });
    },

    async updatePlace(placeId, input, options) {
      const parsedPlaceId = validateOrThrow(PlaceId, placeId, "location place id");
      const body = validateOrThrow(
        LocationPlaceUpdateRequest,
        input,
        "location place update request",
      );
      return await transport.request({
        method: "PATCH",
        path: `/location/places/${encodeURIComponent(parsedPlaceId)}`,
        body,
        response: LocationPlaceMutateResponse,
        signal: options?.signal,
      });
    },

    async deletePlace(placeId, options) {
      const parsedPlaceId = validateOrThrow(PlaceId, placeId, "location place id");
      return await transport.request({
        method: "DELETE",
        path: `/location/places/${encodeURIComponent(parsedPlaceId)}`,
        response: LocationPlaceDeleteResponse,
        signal: options?.signal,
      });
    },

    async getProfile(options) {
      return await transport.request({
        method: "GET",
        path: "/location/profile",
        response: LocationProfileResponse,
        signal: options?.signal,
      });
    },

    async updateProfile(input, options) {
      const body = validateOrThrow(
        LocationProfileUpdateRequest,
        input,
        "location profile update request",
      );
      return await transport.request({
        method: "PATCH",
        path: "/location/profile",
        body,
        response: LocationProfileResponse,
        signal: options?.signal,
      });
    },
  };
}
