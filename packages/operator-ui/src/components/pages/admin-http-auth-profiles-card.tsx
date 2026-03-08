import * as React from "react";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { JsonViewer } from "../ui/json-viewer.js";
import { Label } from "../ui/label.js";
import { Separator } from "../ui/separator.js";
import type { AdminHttpClient } from "./admin-http-shared.js";
import {
  JsonInput,
  resolveJsonValue,
  useApiResultState,
  useJsonInputState,
  type ApiRunner,
  type JsonInputState,
  type OpenMutation,
} from "./admin-http-panels.shared.js";

export interface AdminHttpAuthProfilesCardProps {
  http: AdminHttpClient;
  openMutation: OpenMutation;
  canMutate: boolean;
}

export function AdminHttpAuthProfilesCard({
  http,
  openMutation,
  canMutate,
}: AdminHttpAuthProfilesCardProps) {
  const profiles = useApiResultState("Auth profiles");
  const listProfilesQuery = useJsonInputState("{}");
  const createProfileBody = useJsonInputState(
    JSON.stringify(
      { provider: "provider-1", type: "api_key", secret_handles: { api_key: "secret-1" } },
      null,
      2,
    ),
  );
  const updateProfileBody = useJsonInputState("{}");
  const enableProfileBody = useJsonInputState("{}");
  const disableProfileBody = useJsonInputState(
    JSON.stringify({ reason: "Rotating secrets" }, null, 2),
  );

  const [profileIdForUpdate, setProfileIdForUpdate] = React.useState("");
  const [profileIdForEnable, setProfileIdForEnable] = React.useState("");
  const [profileIdForDisable, setProfileIdForDisable] = React.useState("");

  return (
    <Card data-testid="admin-http-auth-profiles">
      <CardHeader className="pb-2.5">
        <div className="text-sm font-medium text-fg">Auth profiles</div>
        <div className="text-sm text-fg-muted">Manage provider profiles (schema-driven JSON).</div>
      </CardHeader>
      <CardContent className="grid gap-6">
        <AuthProfilesListRow
          http={http}
          busy={profiles.state.busy}
          run={profiles.run}
          query={listProfilesQuery}
        />

        <AuthProfilesCreateRow
          http={http}
          run={profiles.run}
          body={createProfileBody}
          openMutation={openMutation}
          canMutate={canMutate}
        />

        <Separator />

        <AuthProfilesUpdateSection
          http={http}
          run={profiles.run}
          openMutation={openMutation}
          profileId={profileIdForUpdate}
          setProfileId={setProfileIdForUpdate}
          body={updateProfileBody}
          canMutate={canMutate}
        />

        <Separator />

        <div className="grid gap-4 md:grid-cols-2">
          <AuthProfilesEnableSection
            http={http}
            run={profiles.run}
            openMutation={openMutation}
            profileId={profileIdForEnable}
            setProfileId={setProfileIdForEnable}
            body={enableProfileBody}
            canMutate={canMutate}
          />
          <AuthProfilesDisableSection
            http={http}
            run={profiles.run}
            openMutation={openMutation}
            profileId={profileIdForDisable}
            setProfileId={setProfileIdForDisable}
            body={disableProfileBody}
            canMutate={canMutate}
          />
        </div>

        <ApiResultCard
          heading={profiles.state.heading}
          value={profiles.state.value}
          error={profiles.state.error}
        />
      </CardContent>
    </Card>
  );
}

function ProfileIdField({
  id,
  label,
  testId,
  value,
  onChange,
}: {
  id: string;
  label: string;
  testId: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        data-testid={testId}
        value={value}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

function ProfileMutationPreview({ profileId, input }: { profileId: string; input: unknown }) {
  return (
    <div className="grid gap-3">
      <div className="text-sm text-fg">
        <span className="font-medium">Profile ID:</span> {profileId || "(missing)"}
      </div>
      <JsonViewer value={input} />
    </div>
  );
}

function AuthProfilesListRow({
  http,
  busy,
  run,
  query,
}: {
  http: AdminHttpClient;
  busy: boolean;
  run: ApiRunner;
  query: JsonInputState;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <JsonInput
        data-testid="admin-auth-profiles-list-query"
        label="List query (optional)"
        placeholder="{}"
        state={query}
      />

      <div className="flex items-end">
        <Button
          data-testid="admin-auth-profiles-list"
          variant="secondary"
          isLoading={busy}
          disabled={query.errorMessage !== null}
          onClick={() => {
            const value = resolveJsonValue(query, {});
            void run("Auth profiles", async () => await http.authProfiles.list(value as never));
          }}
        >
          List profiles
        </Button>
      </div>
    </div>
  );
}

function AuthProfilesCreateRow({
  http,
  run,
  body,
  openMutation,
  canMutate,
}: {
  http: AdminHttpClient;
  run: ApiRunner;
  body: JsonInputState;
  openMutation: OpenMutation;
  canMutate: boolean;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <JsonInput
        data-testid="admin-auth-profiles-create-json"
        label="Create profile JSON"
        state={body}
      />

      <div className="flex items-end">
        <Button
          data-testid="admin-auth-profiles-create"
          variant="danger"
          disabled={!canMutate || body.errorMessage !== null || typeof body.value === "undefined"}
          onClick={() => {
            const input = resolveJsonValue(body, undefined);
            openMutation({
              title: "Create auth profile",
              description:
                "This creates a new auth profile that can be pinned to sessions/providers.",
              confirmLabel: "Create profile",
              content: <JsonViewer value={input} />,
              onConfirm: async () => {
                const outcome = await run("Auth profile created", async () => {
                  return await http.authProfiles.create(input as never);
                });
                if (!outcome.ok) throw outcome.error;
              },
            });
          }}
        >
          Create profile
        </Button>
      </div>
    </div>
  );
}

function AuthProfilesUpdateSection({
  http,
  run,
  openMutation,
  profileId,
  setProfileId,
  body,
  canMutate,
}: {
  http: AdminHttpClient;
  run: ApiRunner;
  openMutation: OpenMutation;
  profileId: string;
  setProfileId: (next: string) => void;
  body: JsonInputState;
  canMutate: boolean;
}) {
  const trimmed = profileId.trim();

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <ProfileIdField
          id="admin-auth-profile-update-id"
          testId="admin-auth-profiles-update-id"
          label="Profile ID"
          value={profileId}
          onChange={setProfileId}
        />
        <JsonInput
          data-testid="admin-auth-profiles-update-json"
          label="Update JSON"
          placeholder="{}"
          state={body}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="admin-auth-profiles-update"
          variant="danger"
          disabled={!canMutate || trimmed.length === 0 || body.errorMessage !== null}
          onClick={() => {
            const input = resolveJsonValue(body, {});
            openMutation({
              title: "Update auth profile",
              description: "This updates labels/expiry for an auth profile.",
              confirmLabel: "Update profile",
              content: <ProfileMutationPreview profileId={trimmed} input={input} />,
              onConfirm: async () => {
                const outcome = await run("Auth profile updated", async () => {
                  return await http.authProfiles.update(trimmed, input as never);
                });
                if (!outcome.ok) throw outcome.error;
              },
            });
          }}
        >
          Update
        </Button>
      </div>
    </div>
  );
}

function AuthProfilesEnableSection({
  http,
  run,
  openMutation,
  profileId,
  setProfileId,
  body,
  canMutate,
}: {
  http: AdminHttpClient;
  run: ApiRunner;
  openMutation: OpenMutation;
  profileId: string;
  setProfileId: (next: string) => void;
  body: JsonInputState;
  canMutate: boolean;
}) {
  const trimmed = profileId.trim();

  return (
    <div className="grid gap-3">
      <ProfileIdField
        id="admin-auth-profile-enable-id"
        testId="admin-auth-profiles-enable-id"
        label="Enable profile ID"
        value={profileId}
        onChange={setProfileId}
      />
      <JsonInput
        data-testid="admin-auth-profiles-enable-json"
        label="Enable JSON (optional)"
        placeholder="{}"
        state={body}
      />

      <Button
        data-testid="admin-auth-profiles-enable"
        variant="danger"
        disabled={!canMutate || trimmed.length === 0 || body.errorMessage !== null}
        onClick={() => {
          const input = resolveJsonValue(body, {});
          openMutation({
            title: "Enable auth profile",
            description: "This re-enables an auth profile for use in sessions.",
            confirmLabel: "Enable profile",
            content: <ProfileMutationPreview profileId={trimmed} input={input} />,
            onConfirm: async () => {
              const outcome = await run("Auth profile enabled", async () => {
                return await http.authProfiles.enable(trimmed, input as never);
              });
              if (!outcome.ok) throw outcome.error;
            },
          });
        }}
      >
        Enable
      </Button>
    </div>
  );
}

function AuthProfilesDisableSection({
  http,
  run,
  openMutation,
  profileId,
  setProfileId,
  body,
  canMutate,
}: {
  http: AdminHttpClient;
  run: ApiRunner;
  openMutation: OpenMutation;
  profileId: string;
  setProfileId: (next: string) => void;
  body: JsonInputState;
  canMutate: boolean;
}) {
  const trimmed = profileId.trim();

  return (
    <div className="grid gap-3">
      <ProfileIdField
        id="admin-auth-profile-disable-id"
        testId="admin-auth-profiles-disable-id"
        label="Disable profile ID"
        value={profileId}
        onChange={setProfileId}
      />
      <JsonInput
        data-testid="admin-auth-profiles-disable-json"
        label="Disable JSON (optional)"
        placeholder="{}"
        state={body}
      />

      <Button
        data-testid="admin-auth-profiles-disable"
        variant="danger"
        disabled={!canMutate || trimmed.length === 0 || body.errorMessage !== null}
        onClick={() => {
          const input = resolveJsonValue(body, {});
          openMutation({
            title: "Disable auth profile",
            description: "This disables an auth profile until re-enabled.",
            confirmLabel: "Disable profile",
            content: <ProfileMutationPreview profileId={trimmed} input={input} />,
            onConfirm: async () => {
              const outcome = await run("Auth profile disabled", async () => {
                return await http.authProfiles.disable(trimmed, input as never);
              });
              if (!outcome.ok) throw outcome.error;
            },
          });
        }}
      >
        Disable
      </Button>
    </div>
  );
}
