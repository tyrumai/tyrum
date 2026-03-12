import type { NodeInventoryEntry } from "@tyrum/schemas";
import { MapPin } from "lucide-react";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { EmptyState } from "../ui/empty-state.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { Separator } from "../ui/separator.js";

export type PlaceDraft = {
  name: string;
  latitude: string;
  longitude: string;
  radiusM: string;
  tags: string;
};

export type LocationPlace = {
  place_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  tags: string[];
  source: string;
  created_at: string;
  updated_at: string;
};

export type PoiProviderKey = "osm_overpass";

export type ProfileDraft = {
  primaryNodeId: string;
  poiProviderKey: "" | PoiProviderKey;
};

export type LocationProfile = {
  primary_node_id: string | null;
  poi_provider_key?: PoiProviderKey | null;
  updated_at?: string | null;
};

export type LocationHttpApi = {
  listPlaces: () => Promise<{ places: LocationPlace[] }>;
  createPlace: (input: {
    name: string;
    latitude: number;
    longitude: number;
    radius_m: number;
    tags: string[];
  }) => Promise<{ place: LocationPlace }>;
  updatePlace: (
    placeId: string,
    input: {
      name: string;
      latitude: number;
      longitude: number;
      radius_m: number;
      tags: string[];
    },
  ) => Promise<{ place: LocationPlace }>;
  deletePlace: (placeId: string) => Promise<unknown>;
  getProfile: () => Promise<{ profile: LocationProfile }>;
  updateProfile: (input: {
    primary_node_id: string | null;
    poi_provider_key: PoiProviderKey | null;
  }) => Promise<{ profile: LocationProfile }>;
};

export const EMPTY_PLACE_DRAFT: PlaceDraft = {
  name: "",
  latitude: "",
  longitude: "",
  radiusM: "100",
  tags: "",
};

export function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry, index, all) => entry.length > 0 && all.indexOf(entry) === index);
}

export function toPlaceDraft(place: LocationPlace): PlaceDraft {
  return {
    name: place.name,
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    radiusM: String(place.radius_m),
    tags: place.tags.join(", "),
  };
}

export function toProfileDraft(profile: LocationProfile | null): ProfileDraft {
  const poiProviderKey = profile?.poi_provider_key ?? "";
  return {
    primaryNodeId: profile?.primary_node_id ?? "",
    poiProviderKey,
  };
}

export function normalizeOptionalPoiProviderKey(
  value: ProfileDraft["poiProviderKey"],
): PoiProviderKey | null {
  return value === "" ? null : value;
}

export function validatePlaceDraft(draft: PlaceDraft): string | null {
  if (draft.name.trim().length === 0) return "Name is required.";
  const latitude = Number(draft.latitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return "Latitude must be between -90 and 90.";
  }
  const longitude = Number(draft.longitude);
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return "Longitude must be between -180 and 180.";
  }
  const radius = Number(draft.radiusM);
  if (!Number.isFinite(radius) || radius <= 0) {
    return "Radius must be greater than zero.";
  }
  return null;
}

function formatNodeOption(node: NodeInventoryEntry): string {
  if (node.label?.trim()) return `${node.label} (${node.node_id})`;
  return node.node_id;
}

function formatCoordinates(place: LocationPlace): string {
  return `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`;
}

export function LocationProfileCard(props: {
  busyKey: string | null;
  loading: boolean;
  nodes: NodeInventoryEntry[];
  profile: LocationProfile | null;
  profileDirty: boolean;
  profileDraft: ProfileDraft;
  onDraftChange: (patch: Partial<ProfileDraft>) => void;
  onRefresh: () => void;
  onSave: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2.5">
        <div className="text-sm font-medium text-fg">Location profile</div>
        <div className="text-sm text-fg-muted">
          Choose the primary tracked node and the POI provider used for category lookups.
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Select
            label="Primary tracked node"
            data-testid="location-profile-primary-node"
            value={props.profileDraft.primaryNodeId}
            disabled={props.loading || props.busyKey !== null}
            onChange={(event) => {
              props.onDraftChange({ primaryNodeId: event.currentTarget.value });
            }}
          >
            <option value="">No primary node assigned</option>
            {props.nodes.map((node) => (
              <option key={node.node_id} value={node.node_id}>
                {formatNodeOption(node)}
              </option>
            ))}
          </Select>

          <Select
            label="POI provider"
            data-testid="location-profile-poi-provider"
            value={props.profileDraft.poiProviderKey}
            disabled={props.loading || props.busyKey !== null}
            onChange={(event) => {
              props.onDraftChange({
                poiProviderKey: event.currentTarget.value as ProfileDraft["poiProviderKey"],
              });
            }}
          >
            <option value="">Disabled</option>
            <option value="osm_overpass">OpenStreetMap Overpass</option>
          </Select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-fg-muted">
            {props.profile?.updated_at
              ? `Last updated ${formatRelativeTime(props.profile.updated_at)}`
              : "No profile has been saved yet."}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              data-testid="location-refresh"
              disabled={props.busyKey !== null}
              onClick={props.onRefresh}
            >
              Refresh
            </Button>
            <Button
              data-testid="location-profile-save"
              isLoading={props.busyKey === "profile"}
              disabled={!props.profileDirty || props.loading}
              onClick={props.onSave}
            >
              Save profile
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function LocationPlacesCard(props: {
  busyKey: string | null;
  loading: boolean;
  places: LocationPlace[];
  editingPlaceId: string | null;
  placeDraft: PlaceDraft;
  placeValidationError: string | null;
  onStartEdit: (place: LocationPlace) => void;
  onDelete: (place: LocationPlace) => void;
  onReset: () => void;
  onDraftChange: (patch: Partial<PlaceDraft>) => void;
  onSave: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2.5">
        <div className="text-sm font-medium text-fg">Saved places</div>
        <div className="text-sm text-fg-muted">
          Create named places that automation and memory can refer to deterministically.
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {props.loading && props.places.length === 0 ? (
          <div className="text-sm text-fg-muted">Loading saved places...</div>
        ) : props.places.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="No saved places"
            description="Add a named place to start using location-aware automations."
          />
        ) : (
          <div className="grid gap-3">
            {props.places.map((place) => (
              <div
                key={place.place_id}
                className="grid gap-3 rounded-lg border border-border/70 bg-panel px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-fg">{place.name}</span>
                      <Badge variant="outline">{place.source}</Badge>
                    </div>
                    <div className="text-sm text-fg-muted">
                      {formatCoordinates(place)} · radius {place.radius_m} m
                    </div>
                    <div className="text-xs text-fg-muted">
                      Updated {formatRelativeTime(place.updated_at)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      data-testid={`location-place-edit-${place.place_id}`}
                      disabled={props.busyKey !== null}
                      onClick={() => {
                        props.onStartEdit(place);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      data-testid={`location-place-delete-${place.place_id}`}
                      disabled={props.busyKey !== null}
                      onClick={() => {
                        props.onDelete(place);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                {place.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {place.tags.map((tag) => (
                      <Badge key={`${place.place_id}:${tag}`} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        <Separator />

        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-fg">
                {props.editingPlaceId ? "Edit place" : "Add place"}
              </div>
              <div className="text-sm text-fg-muted">
                Use a generic name and exact coordinates. Tags are optional.
              </div>
            </div>
            {props.editingPlaceId ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={props.busyKey !== null}
                onClick={props.onReset}
              >
                Cancel edit
              </Button>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Input
              label="Place name"
              data-testid="location-place-name"
              placeholder="Home"
              value={props.placeDraft.name}
              disabled={props.busyKey !== null}
              onChange={(event) => props.onDraftChange({ name: event.currentTarget.value })}
            />
            <Input
              label="Tags"
              data-testid="location-place-tags"
              placeholder="home, favorite"
              helperText="Comma-separated values."
              value={props.placeDraft.tags}
              disabled={props.busyKey !== null}
              onChange={(event) => props.onDraftChange({ tags: event.currentTarget.value })}
            />
            <Input
              label="Latitude"
              data-testid="location-place-latitude"
              inputMode="decimal"
              placeholder="52.3676"
              value={props.placeDraft.latitude}
              disabled={props.busyKey !== null}
              onChange={(event) => props.onDraftChange({ latitude: event.currentTarget.value })}
            />
            <Input
              label="Longitude"
              data-testid="location-place-longitude"
              inputMode="decimal"
              placeholder="4.9041"
              value={props.placeDraft.longitude}
              disabled={props.busyKey !== null}
              onChange={(event) => props.onDraftChange({ longitude: event.currentTarget.value })}
            />
            <Input
              label="Radius (m)"
              data-testid="location-place-radius"
              inputMode="decimal"
              placeholder="100"
              value={props.placeDraft.radiusM}
              disabled={props.busyKey !== null}
              onChange={(event) => props.onDraftChange({ radiusM: event.currentTarget.value })}
            />
          </div>

          {props.placeValidationError ? (
            <Alert
              variant="warning"
              title="Place form incomplete"
              description={props.placeValidationError}
            />
          ) : null}

          <div className="flex justify-end">
            <Button
              data-testid="location-place-save"
              isLoading={props.busyKey === "place"}
              disabled={props.busyKey !== null || props.placeValidationError !== null}
              onClick={props.onSave}
            >
              {props.editingPlaceId ? "Save changes" : "Create place"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
