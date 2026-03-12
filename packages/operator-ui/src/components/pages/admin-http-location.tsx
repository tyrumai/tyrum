import type { OperatorCore } from "@tyrum/operator-core";
import type { NodeInventoryEntry } from "@tyrum/schemas";
import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { useAdminHttpClient, useAdminMutationAccess } from "./admin-http-shared.js";
import {
  EMPTY_PLACE_DRAFT,
  LocationPlacesCard,
  LocationProfileCard,
  type LocationHttpApi,
  type LocationPlace,
  type LocationProfile,
  normalizeOptionalPoiProviderKey,
  normalizeOptionalText,
  parseTags,
  toPlaceDraft,
  toProfileDraft,
  validatePlaceDraft,
} from "./admin-http-location-sections.js";

export function AdminHttpLocationPanel({ core }: { core: OperatorCore }) {
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const adminHttp = useAdminHttpClient();
  const locationHttp =
    (adminHttp as { location?: LocationHttpApi } | null)?.location ??
    (core.http as { location?: LocationHttpApi }).location;

  const [places, setPlaces] = React.useState<LocationPlace[]>([]);
  const [profile, setProfile] = React.useState<LocationProfile | null>(null);
  const [nodes, setNodes] = React.useState<NodeInventoryEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [mutationError, setMutationError] = React.useState<string | null>(null);
  const [editingPlaceId, setEditingPlaceId] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<LocationPlace | null>(null);
  const [profileDraft, setProfileDraft] = React.useState(() => toProfileDraft(null));
  const [placeDraft, setPlaceDraft] = React.useState(EMPTY_PLACE_DRAFT);

  const loadData = React.useCallback(async () => {
    if (!locationHttp) {
      setLoading(false);
      setLoadError(null);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const [placesResponse, profileResponse, nodesResponse] = await Promise.all([
        locationHttp.listPlaces(),
        locationHttp.getProfile(),
        core.http.nodes.list({ dispatchable_only: false }),
      ]);
      setPlaces(placesResponse.places);
      setProfile(profileResponse.profile);
      setProfileDraft(toProfileDraft(profileResponse.profile));
      setNodes(nodesResponse.nodes);
    } catch (error) {
      setLoadError(formatErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [core.http.nodes, locationHttp]);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  const placeValidationError = React.useMemo(() => validatePlaceDraft(placeDraft), [placeDraft]);
  const profileDirty = React.useMemo(() => {
    const current = toProfileDraft(profile);
    return (
      current.primaryNodeId !== profileDraft.primaryNodeId ||
      current.poiProviderKey !== profileDraft.poiProviderKey.trim()
    );
  }, [profile, profileDraft]);

  const resetPlaceEditor = React.useCallback(() => {
    setEditingPlaceId(null);
    setPlaceDraft(EMPTY_PLACE_DRAFT);
  }, []);

  const saveProfile = React.useCallback(async () => {
    if (!locationHttp) return;
    if (!canMutate) {
      requestEnter();
      return;
    }

    setBusyKey("profile");
    setMutationError(null);
    try {
      const response = await locationHttp.updateProfile({
        primary_node_id: normalizeOptionalText(profileDraft.primaryNodeId),
        poi_provider_key: normalizeOptionalPoiProviderKey(profileDraft.poiProviderKey),
      });
      setProfile(response.profile);
      setProfileDraft(toProfileDraft(response.profile));
    } catch (error) {
      setMutationError(formatErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  }, [canMutate, locationHttp, profileDraft, requestEnter]);

  const savePlace = React.useCallback(async () => {
    if (!locationHttp || placeValidationError) return;
    if (!canMutate) {
      requestEnter();
      return;
    }

    setBusyKey("place");
    setMutationError(null);
    try {
      const input = {
        name: placeDraft.name.trim(),
        latitude: Number(placeDraft.latitude),
        longitude: Number(placeDraft.longitude),
        radius_m: Number(placeDraft.radiusM),
        tags: parseTags(placeDraft.tags),
      };
      const response = editingPlaceId
        ? await locationHttp.updatePlace(editingPlaceId, input)
        : await locationHttp.createPlace(input);
      setPlaces((current) =>
        editingPlaceId
          ? current.map((place) =>
              place.place_id === response.place.place_id ? response.place : place,
            )
          : [...current, response.place],
      );
      resetPlaceEditor();
    } catch (error) {
      setMutationError(formatErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  }, [
    canMutate,
    editingPlaceId,
    locationHttp,
    placeDraft,
    placeValidationError,
    requestEnter,
    resetPlaceEditor,
  ]);

  const deletePlace = React.useCallback(async () => {
    if (!locationHttp || !deleteTarget) return;
    if (!canMutate) {
      requestEnter();
      throw new Error("Enter Elevated Mode to delete a saved place.");
    }

    setBusyKey(`delete:${deleteTarget.place_id}`);
    setMutationError(null);
    try {
      await locationHttp.deletePlace(deleteTarget.place_id);
      setPlaces((current) => current.filter((place) => place.place_id !== deleteTarget.place_id));
      if (editingPlaceId === deleteTarget.place_id) {
        resetPlaceEditor();
      }
      setDeleteTarget(null);
    } catch (error) {
      const message = formatErrorMessage(error);
      setMutationError(message);
      throw error instanceof Error ? error : new Error(message);
    } finally {
      setBusyKey(null);
    }
  }, [canMutate, deleteTarget, editingPlaceId, locationHttp, requestEnter, resetPlaceEditor]);

  if (!locationHttp) {
    return (
      <div className="grid gap-4" data-testid="admin-http-location">
        <Alert
          variant="warning"
          title="Location routes unavailable"
          description="This build does not include the typed location HTTP client yet."
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="admin-http-location">
      {loadError ? (
        <Alert variant="error" title="Failed to load location settings" description={loadError} />
      ) : null}
      {mutationError ? (
        <Alert variant="error" title="Location update failed" description={mutationError} />
      ) : null}

      <LocationProfileCard
        busyKey={busyKey}
        loading={loading}
        nodes={nodes}
        profile={profile}
        profileDirty={profileDirty}
        profileDraft={profileDraft}
        onDraftChange={(patch) => {
          setProfileDraft((current) => ({ ...current, ...patch }));
        }}
        onRefresh={() => {
          void loadData();
        }}
        onSave={() => {
          void saveProfile();
        }}
      />

      <LocationPlacesCard
        busyKey={busyKey}
        loading={loading}
        places={places}
        editingPlaceId={editingPlaceId}
        placeDraft={placeDraft}
        placeValidationError={placeValidationError}
        onStartEdit={(place) => {
          setEditingPlaceId(place.place_id);
          setPlaceDraft(toPlaceDraft(place));
          setMutationError(null);
        }}
        onDelete={(place) => {
          setDeleteTarget(place);
        }}
        onReset={resetPlaceEditor}
        onDraftChange={(patch) => {
          setPlaceDraft((current) => ({ ...current, ...patch }));
        }}
        onSave={() => {
          void savePlace();
        }}
      />

      <ConfirmDangerDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget?.name ?? "place"}?`}
        description="This removes the canonical saved place used by location rules and memory references."
        confirmLabel="Delete place"
        onConfirm={async () => {
          await deletePlace();
        }}
      />
    </div>
  );
}
