import type { OperatorCore } from "@tyrum/operator-app";
import type { NodeInventoryEntry } from "@tyrum/contracts";
import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import {
  useAdminHttpClient,
  useAdminMutationAccess,
  useAdminMutationHttpClient,
} from "./admin-http-shared.js";
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
  const mutationHttp = useAdminMutationHttpClient();
  const locationHttp =
    (adminHttp as { location?: LocationHttpApi }).location ??
    (core.admin as { location?: LocationHttpApi }).location;
  const mutationLocationHttp =
    (mutationHttp as { location?: LocationHttpApi } | null)?.location ?? null;

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
        core.admin.nodes.list({ dispatchable_only: false }),
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
  }, [core.admin.nodes, locationHttp]);

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
    if (!canMutate) {
      requestEnter();
      return;
    }

    setBusyKey("profile");
    setMutationError(null);
    try {
      if (!mutationLocationHttp) {
        throw new Error("Admin access is required to update the location profile.");
      }
      const response = await mutationLocationHttp.updateProfile({
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
  }, [canMutate, mutationLocationHttp, profileDraft, requestEnter]);

  const savePlace = React.useCallback(async () => {
    if (placeValidationError) return;
    if (!canMutate) {
      requestEnter();
      return;
    }

    setBusyKey("place");
    setMutationError(null);
    try {
      if (!mutationLocationHttp) {
        throw new Error("Admin access is required to save places.");
      }
      const input = {
        name: placeDraft.name.trim(),
        latitude: Number(placeDraft.latitude),
        longitude: Number(placeDraft.longitude),
        radius_m: Number(placeDraft.radiusM),
        tags: parseTags(placeDraft.tags),
      };
      const response = editingPlaceId
        ? await mutationLocationHttp.updatePlace(editingPlaceId, input)
        : await mutationLocationHttp.createPlace(input);
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
    mutationLocationHttp,
    placeDraft,
    placeValidationError,
    requestEnter,
    resetPlaceEditor,
  ]);

  const deletePlace = React.useCallback(async () => {
    if (!deleteTarget) return;
    if (!canMutate) {
      requestEnter();
      throw new Error("Authorize admin access to delete a saved place.");
    }

    setBusyKey(`delete:${deleteTarget.place_id}`);
    setMutationError(null);
    try {
      if (!mutationLocationHttp) {
        throw new Error("Admin access is required to delete saved places.");
      }
      await mutationLocationHttp.deletePlace(deleteTarget.place_id);
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
  }, [
    canMutate,
    deleteTarget,
    editingPlaceId,
    mutationLocationHttp,
    requestEnter,
    resetPlaceEditor,
  ]);

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
        <Alert
          variant="error"
          title="Failed to load location settings"
          description={loadError}
          onDismiss={() => setLoadError(null)}
        />
      ) : null}
      {mutationError ? (
        <Alert
          variant="error"
          title="Location update failed"
          description={mutationError}
          onDismiss={() => setMutationError(null)}
        />
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
