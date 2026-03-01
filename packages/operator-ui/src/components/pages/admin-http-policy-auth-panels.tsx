import * as React from "react";
import { useAdminHttpClient } from "./admin-http-shared.js";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Input } from "../ui/input.js";
import { JsonTextarea, type JsonTextareaProps } from "../ui/json-textarea.js";
import { JsonViewer } from "../ui/json-viewer.js";
import { Label } from "../ui/label.js";
import { Separator } from "../ui/separator.js";

type ApiResultState = {
  heading: string;
  value: unknown | undefined;
  error: unknown | undefined;
  busy: boolean;
};

type ApiRunOutcome = { ok: true; value: unknown } | { ok: false; error: unknown };

function useApiResultState(initialHeading: string): {
  state: ApiResultState;
  run: (heading: string, fn: () => Promise<unknown>) => Promise<ApiRunOutcome>;
} {
  const [state, setState] = React.useState<ApiResultState>({
    heading: initialHeading,
    value: undefined,
    error: undefined,
    busy: false,
  });

  const run = React.useCallback(
    async (heading: string, fn: () => Promise<unknown>): Promise<ApiRunOutcome> => {
      setState((prev) => ({ ...prev, heading, busy: true, error: undefined }));
      try {
        const value = await fn();
        setState((prev) => ({ ...prev, value, busy: false }));
        return { ok: true, value };
      } catch (error) {
        setState((prev) => ({ ...prev, error, value: undefined, busy: false }));
        return { ok: false, error };
      }
    },
    [],
  );

  return { state, run };
}

function useJsonInputState(initialValue: string): {
  raw: string;
  setRaw: (next: string) => void;
  value: unknown | undefined;
  errorMessage: string | null;
  setValue: (next: unknown | undefined) => void;
  setErrorMessage: (next: string | null) => void;
} {
  const [raw, setRaw] = React.useState(initialValue);
  const [value, setValue] = React.useState<unknown | undefined>(undefined);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  return { raw, setRaw, value, errorMessage, setValue, setErrorMessage };
}

function JsonInput({
  state,
  ...props
}: Omit<JsonTextareaProps, "value" | "onChange" | "onJsonChange"> & {
  state: ReturnType<typeof useJsonInputState>;
}): React.ReactElement {
  return (
    <JsonTextarea
      value={state.raw}
      onChange={(event) => {
        state.setRaw(event.target.value);
      }}
      onJsonChange={(value, errorMessage) => {
        state.setValue(value);
        state.setErrorMessage(errorMessage);
      }}
      {...props}
    />
  );
}

type PendingMutation = {
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  confirmationLabel?: React.ReactNode;
  content?: React.ReactNode;
  onConfirm: () => Promise<void>;
};

export function AdminHttpPolicyAuthPanels() {
  const http = useAdminHttpClient();
  const bundle = useApiResultState("Policy bundle");
  const overrides = useApiResultState("Policy overrides");
  const profiles = useApiResultState("Auth profiles");
  const pins = useApiResultState("Auth pins");

  const listOverridesQuery = useJsonInputState("{}");
  const createOverrideBody = useJsonInputState(
    JSON.stringify({ agent_id: "agent-1", tool_id: "tool-1", pattern: ".*" }, null, 2),
  );
  const revokeOverrideBody = useJsonInputState(
    JSON.stringify(
      { policy_override_id: "00000000-0000-0000-0000-000000000000", reason: "No longer needed" },
      null,
      2,
    ),
  );

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
  const disableProfileBody = useJsonInputState(JSON.stringify({ reason: "Rotating secrets" }, null, 2));

  const listPinsQuery = useJsonInputState("{}");
  const setPinBody = useJsonInputState(
    JSON.stringify(
      {
        session_id: "session-1",
        provider: "provider-1",
        profile_id: "00000000-0000-0000-0000-000000000000",
      },
      null,
      2,
    ),
  );

  const [profileIdForUpdate, setProfileIdForUpdate] = React.useState("");
  const [profileIdForEnable, setProfileIdForEnable] = React.useState("");
  const [profileIdForDisable, setProfileIdForDisable] = React.useState("");

  const [pendingMutation, setPendingMutation] = React.useState<PendingMutation | null>(null);

  const openMutation = React.useCallback((mutation: PendingMutation): void => {
    setPendingMutation(mutation);
  }, []);

  const closeMutation = React.useCallback((): void => {
    setPendingMutation(null);
  }, []);

  const resolveJsonValue = (input: { value: unknown | undefined }, fallback: unknown): unknown => {
    if (typeof input.value === "undefined") return fallback;
    return input.value;
  };

  if (!http) {
    return (
      <div className="grid gap-4" data-testid="admin-http-policy-auth-panels">
        <Alert
          variant="warning"
          title="Enter Admin Mode to continue"
          description="Admin Mode is required for this action."
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="admin-http-policy-auth-panels">
      <Card data-testid="admin-http-policy">
        <CardHeader className="pb-4">
          <div className="text-sm font-medium text-fg">Policy</div>
          <div className="text-sm text-fg-muted">View the effective policy bundle and manage overrides.</div>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid gap-0.5">
                <div className="text-sm font-medium text-fg">Effective bundle</div>
                <div className="text-xs text-fg-muted">Resolved deployment + agent + playbook policy bundle.</div>
              </div>
              <Button
                data-testid="admin-policy-bundle-fetch"
                variant="secondary"
                isLoading={bundle.state.busy}
                onClick={() => {
                  void bundle.run("Policy bundle", async () => await http.policy.getBundle());
                }}
              >
                Fetch bundle
              </Button>
            </div>
            <ApiResultCard heading={bundle.state.heading} value={bundle.state.value} error={bundle.state.error} />
          </div>

          <Separator />

          <div className="grid gap-4">
            <div className="grid gap-1">
              <div className="text-sm font-medium text-fg">Overrides</div>
              <div className="text-xs text-fg-muted">Overrides have global impact across the gateway instance.</div>
            </div>

            <Alert
              variant="warning"
              title="Global impact"
              description="Policy overrides apply to all operators and runs. Use short TTLs when possible."
            />

            <div className="grid gap-3 md:grid-cols-2">
              <JsonInput
                data-testid="admin-policy-overrides-list-query"
                label="List query (optional)"
                placeholder="{}"
                state={listOverridesQuery}
              />

              <div className="flex items-end">
                <Button
                  data-testid="admin-policy-overrides-list"
                  variant="secondary"
                  isLoading={overrides.state.busy}
                  disabled={listOverridesQuery.errorMessage !== null}
                  onClick={() => {
                    const query = resolveJsonValue(listOverridesQuery, {});
                    void overrides.run("Policy overrides", async () => await http.policy.listOverrides(query as never));
                  }}
                >
                  List overrides
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <JsonInput data-testid="admin-policy-override-create-json" label="Create override JSON" state={createOverrideBody} />

              <div className="flex items-end gap-2">
                <Button
                  data-testid="admin-policy-override-create"
                  variant="danger"
                  disabled={
                    createOverrideBody.errorMessage !== null ||
                    typeof createOverrideBody.value === "undefined"
                  }
                  onClick={() => {
                    const input = resolveJsonValue(createOverrideBody, undefined);
                    openMutation({
                      title: "Create policy override",
                      description: "This affects policy globally for the gateway instance.",
                      confirmLabel: "Create override",
                      content: <JsonViewer value={input} />,
                      onConfirm: async () => {
                        const outcome = await overrides.run("Policy override created", async () => {
                          return await http.policy.createOverride(input as never);
                        });
                        if (!outcome.ok) throw outcome.error;
                      },
                    });
                  }}
                >
                  Create override
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <JsonInput data-testid="admin-policy-override-revoke-json" label="Revoke override JSON" state={revokeOverrideBody} />

              <div className="flex items-end gap-2">
                <Button
                  data-testid="admin-policy-override-revoke"
                  variant="danger"
                  disabled={
                    revokeOverrideBody.errorMessage !== null ||
                    typeof revokeOverrideBody.value === "undefined"
                  }
                  onClick={() => {
                    const input = resolveJsonValue(revokeOverrideBody, undefined);
                    openMutation({
                      title: "Revoke policy override",
                      description: "This affects policy globally for the gateway instance.",
                      confirmLabel: "Revoke override",
                      content: <JsonViewer value={input} />,
                      onConfirm: async () => {
                        const outcome = await overrides.run("Policy override revoked", async () => {
                          return await http.policy.revokeOverride(input as never);
                        });
                        if (!outcome.ok) throw outcome.error;
                      },
                    });
                  }}
                >
                  Revoke override
                </Button>
              </div>
            </div>

            <ApiResultCard heading={overrides.state.heading} value={overrides.state.value} error={overrides.state.error} />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="admin-http-auth-profiles">
        <CardHeader className="pb-4">
          <div className="text-sm font-medium text-fg">Auth profiles</div>
          <div className="text-sm text-fg-muted">Manage provider profiles (schema-driven JSON).</div>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-3 md:grid-cols-2">
            <JsonInput
              data-testid="admin-auth-profiles-list-query"
              label="List query (optional)"
              placeholder="{}"
              state={listProfilesQuery}
            />

            <div className="flex items-end">
              <Button
                data-testid="admin-auth-profiles-list"
                variant="secondary"
                isLoading={profiles.state.busy}
                disabled={listProfilesQuery.errorMessage !== null}
                onClick={() => {
                  const query = resolveJsonValue(listProfilesQuery, {});
                  void profiles.run("Auth profiles", async () => await http.authProfiles.list(query as never));
                }}
              >
                List profiles
              </Button>
            </div>
          </div>

          <Separator />

          <div className="grid gap-3 md:grid-cols-2">
            <JsonInput data-testid="admin-auth-profiles-create-json" label="Create profile JSON" state={createProfileBody} />

            <div className="flex items-end">
              <Button
                data-testid="admin-auth-profiles-create"
                variant="danger"
                disabled={
                  createProfileBody.errorMessage !== null ||
                  typeof createProfileBody.value === "undefined"
                }
                onClick={() => {
                  const input = resolveJsonValue(createProfileBody, undefined);
                  openMutation({
                    title: "Create auth profile",
                    description: "This creates a new auth profile that can be pinned to sessions/providers.",
                    confirmLabel: "Create profile",
                    content: <JsonViewer value={input} />,
                    onConfirm: async () => {
                      const outcome = await profiles.run("Auth profile created", async () => {
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

          <Separator />

          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="admin-auth-profile-update-id">Profile ID</Label>
                <Input
                  id="admin-auth-profile-update-id"
                  data-testid="admin-auth-profiles-update-id"
                  value={profileIdForUpdate}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  onChange={(event) => {
                    setProfileIdForUpdate(event.target.value);
                  }}
                />
              </div>
              <JsonInput
                data-testid="admin-auth-profiles-update-json"
                label="Update JSON"
                placeholder="{}"
                state={updateProfileBody}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                data-testid="admin-auth-profiles-update"
                variant="danger"
                disabled={
                  profileIdForUpdate.trim().length === 0 || updateProfileBody.errorMessage !== null
                }
                onClick={() => {
                  const profileId = profileIdForUpdate.trim();
                  const input = resolveJsonValue(updateProfileBody, {});
                  openMutation({
                    title: "Update auth profile",
                    description: "This updates labels/expiry for an auth profile.",
                    confirmLabel: "Update profile",
                    content: (
                      <div className="grid gap-3">
                        <div className="text-sm text-fg">
                          <span className="font-medium">Profile ID:</span> {profileId || "(missing)"}
                        </div>
                        <JsonViewer value={input} />
                      </div>
                    ),
                    onConfirm: async () => {
                      const outcome = await profiles.run("Auth profile updated", async () => {
                        return await http.authProfiles.update(profileId, input as never);
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

          <Separator />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="admin-auth-profile-enable-id">Enable profile ID</Label>
                <Input
                  id="admin-auth-profile-enable-id"
                  data-testid="admin-auth-profiles-enable-id"
                  value={profileIdForEnable}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  onChange={(event) => {
                    setProfileIdForEnable(event.target.value);
                  }}
                />
              </div>
              <JsonInput
                data-testid="admin-auth-profiles-enable-json"
                label="Enable JSON (optional)"
                placeholder="{}"
                state={enableProfileBody}
              />
              <Button
                data-testid="admin-auth-profiles-enable"
                variant="danger"
                disabled={
                  profileIdForEnable.trim().length === 0 || enableProfileBody.errorMessage !== null
                }
                onClick={() => {
                  const profileId = profileIdForEnable.trim();
                  const input = resolveJsonValue(enableProfileBody, {});
                  openMutation({
                    title: "Enable auth profile",
                    description: "This re-enables an auth profile for use in sessions.",
                    confirmLabel: "Enable profile",
                    content: (
                      <div className="grid gap-3">
                        <div className="text-sm text-fg">
                          <span className="font-medium">Profile ID:</span> {profileId || "(missing)"}
                        </div>
                        <JsonViewer value={input} />
                      </div>
                    ),
                    onConfirm: async () => {
                      const outcome = await profiles.run("Auth profile enabled", async () => {
                        return await http.authProfiles.enable(profileId, input as never);
                      });
                      if (!outcome.ok) throw outcome.error;
                    },
                  });
                }}
              >
                Enable
              </Button>
            </div>

            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="admin-auth-profile-disable-id">Disable profile ID</Label>
                <Input
                  id="admin-auth-profile-disable-id"
                  data-testid="admin-auth-profiles-disable-id"
                  value={profileIdForDisable}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  onChange={(event) => {
                    setProfileIdForDisable(event.target.value);
                  }}
                />
              </div>
              <JsonInput
                data-testid="admin-auth-profiles-disable-json"
                label="Disable JSON (optional)"
                placeholder="{}"
                state={disableProfileBody}
              />
              <Button
                data-testid="admin-auth-profiles-disable"
                variant="danger"
                disabled={
                  profileIdForDisable.trim().length === 0 || disableProfileBody.errorMessage !== null
                }
                onClick={() => {
                  const profileId = profileIdForDisable.trim();
                  const input = resolveJsonValue(disableProfileBody, {});
                  openMutation({
                    title: "Disable auth profile",
                    description: "This disables an auth profile until re-enabled.",
                    confirmLabel: "Disable profile",
                    content: (
                      <div className="grid gap-3">
                        <div className="text-sm text-fg">
                          <span className="font-medium">Profile ID:</span> {profileId || "(missing)"}
                        </div>
                        <JsonViewer value={input} />
                      </div>
                    ),
                    onConfirm: async () => {
                      const outcome = await profiles.run("Auth profile disabled", async () => {
                        return await http.authProfiles.disable(profileId, input as never);
                      });
                      if (!outcome.ok) throw outcome.error;
                    },
                  });
                }}
              >
                Disable
              </Button>
            </div>
          </div>

          <ApiResultCard heading={profiles.state.heading} value={profiles.state.value} error={profiles.state.error} />
        </CardContent>
      </Card>

      <Card data-testid="admin-http-auth-pins">
        <CardHeader className="pb-4">
          <div className="text-sm font-medium text-fg">Auth pins</div>
          <div className="text-sm text-fg-muted">Pin sessions/providers to a specific auth profile.</div>
        </CardHeader>
        <CardContent className="grid gap-6">
          <Alert
            variant="warning"
            title="Global impact"
            description="Pins affect routing for live sessions across the gateway instance."
          />

          <div className="grid gap-3 md:grid-cols-2">
            <JsonInput
              data-testid="admin-auth-pins-list-query"
              label="List query (optional)"
              placeholder="{}"
              state={listPinsQuery}
            />

            <div className="flex items-end">
              <Button
                data-testid="admin-auth-pins-list"
                variant="secondary"
                isLoading={pins.state.busy}
                disabled={listPinsQuery.errorMessage !== null}
                onClick={() => {
                  const query = resolveJsonValue(listPinsQuery, {});
                  void pins.run("Auth pins", async () => await http.authPins.list(query as never));
                }}
              >
                List pins
              </Button>
            </div>
          </div>

          <Separator />

          <div className="grid gap-3 md:grid-cols-2">
            <JsonInput
              data-testid="admin-auth-pins-set-json"
              label="Set pin JSON"
              helperText="Set profile_id to null to clear a pin."
              state={setPinBody}
            />

            <div className="flex items-end">
              <Button
                data-testid="admin-auth-pins-set"
                variant="danger"
                disabled={setPinBody.errorMessage !== null || typeof setPinBody.value === "undefined"}
                onClick={() => {
                  const input = resolveJsonValue(setPinBody, undefined);
                  openMutation({
                    title: "Set auth pin",
                    description: "Pins affect live sessions globally for the gateway instance.",
                    confirmLabel: "Set pin",
                    content: <JsonViewer value={input} />,
                    onConfirm: async () => {
                      const outcome = await pins.run("Auth pin updated", async () => {
                        return await http.authPins.set(input as never);
                      });
                      if (!outcome.ok) throw outcome.error;
                    },
                  });
                }}
              >
                Set / clear pin
              </Button>
            </div>
          </div>

          <ApiResultCard heading={pins.state.heading} value={pins.state.value} error={pins.state.error} />
        </CardContent>
      </Card>

      <ConfirmDangerDialog
        open={pendingMutation !== null}
        onOpenChange={(open) => {
          if (open) return;
          closeMutation();
        }}
        title={pendingMutation?.title ?? "Confirm"}
        description={pendingMutation?.description}
        confirmLabel={pendingMutation?.confirmLabel}
        confirmationLabel={pendingMutation?.confirmationLabel}
        onConfirm={async () => {
          if (!pendingMutation) return;
          await pendingMutation.onConfirm();
        }}
      >
        {pendingMutation?.content}
      </ConfirmDangerDialog>
    </div>
  );
}
