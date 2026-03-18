import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { ChannelFieldSections } from "./admin-http-channels-dialog-fields.js";
import {
  buildConfigPayload,
  buildInitialFormState,
  buildSecretPayload,
  clearChannelFieldError,
  readChannelFieldErrors,
  type AdminChannelApi,
  type AgentOption,
  type ChannelFieldErrors,
  type ChannelFormState,
  type ChannelRegistryEntry,
  type ConfiguredChannelAccount,
  type ConfiguredChannelGroup,
} from "./admin-http-channels-shared.js";

export function ChannelAccountDialog({
  open,
  onOpenChange,
  registry,
  groups,
  account,
  agentOptions,
  api,
  canMutate,
  requestEnter,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registry: ChannelRegistryEntry[];
  groups: ConfiguredChannelGroup[];
  account: ConfiguredChannelAccount | null;
  agentOptions: readonly AgentOption[];
  api: AdminChannelApi | null;
  canMutate: boolean;
  requestEnter: () => void;
  onSaved: () => Promise<void>;
}) {
  const initialEntry = registry.find((entry) => entry.channel === account?.channel) ?? registry[0];
  const [state, setState] = React.useState<ChannelFormState | null>(
    initialEntry ? buildInitialFormState({ entry: initialEntry, account, agentOptions }) : null,
  );
  const [saving, setSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<ChannelFieldErrors>({});

  React.useEffect(() => {
    if (!open) {
      setSaving(false);
      setErrorMessage(null);
      setFieldErrors({});
      return;
    }
    const nextEntry = registry.find((entry) => entry.channel === account?.channel) ?? registry[0];
    setState(nextEntry ? buildInitialFormState({ entry: nextEntry, account, agentOptions }) : null);
  }, [account, agentOptions, open, registry]);

  const entry = registry.find((candidate) => candidate.channel === state?.channel);
  const fieldErrorText = React.useCallback(
    (fieldKey: string): string | null => {
      const messages = fieldErrors[fieldKey];
      return messages && messages.length > 0 ? messages.join(" ") : null;
    },
    [fieldErrors],
  );
  const accountKeyConflict =
    !account &&
    state?.accountKey.trim() &&
    groups.some((group) =>
      group.accounts.some(
        (existing) =>
          existing.channel === state?.channel &&
          existing.account_key.toLowerCase() === state.accountKey.trim().toLowerCase(),
      ),
    );

  const save = async (): Promise<void> => {
    if (!api || !entry || !state) {
      throw new Error("Channels config API unavailable.");
    }
    if (!canMutate) {
      requestEnter();
      throw new Error("Authorize admin access to change channel settings.");
    }

    setSaving(true);
    setErrorMessage(null);
    setFieldErrors({});
    try {
      const config = buildConfigPayload(entry, state);
      const secrets = buildSecretPayload(entry, state);
      if (account) {
        await api.updateAccount(account.channel, account.account_key, {
          config,
          ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
          clear_secret_keys: Object.entries(state.clearSecretKeys)
            .filter(([, checked]) => checked)
            .map(([key]) => key),
        });
      } else {
        await api.createAccount({
          channel: entry.channel,
          account_key: state.accountKey.trim(),
          config,
          secrets,
        });
      }
      await onSaved();
      onOpenChange(false);
    } catch (error) {
      setFieldErrors(readChannelFieldErrors(error));
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="channels-account-dialog"
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>{account ? "Edit channel account" : "Add channel account"}</DialogTitle>
          <DialogDescription>
            Configure a channel account, resolve access rules to canonical IDs, and bind inbound
            messages to a single agent.
          </DialogDescription>
        </DialogHeader>

        {!state || !entry ? (
          <Alert
            variant="warning"
            title="No configurable channels available"
            description="The gateway did not return any channel setup metadata."
          />
        ) : (
          <div className="grid gap-4">
            {entry.intro_title || entry.intro_lines.length > 0 ? (
              <Alert
                variant="info"
                title={entry.intro_title ?? `${entry.name} setup`}
                description={
                  <div className="grid gap-1">
                    {entry.intro_lines.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </div>
                }
              />
            ) : null}

            {!account ? (
              <Select
                label="Channel"
                data-testid="channels-account-channel"
                value={state.channel}
                onChange={(event) => {
                  const nextEntry = registry.find(
                    (candidate) => candidate.channel === event.currentTarget.value,
                  );
                  if (!nextEntry) {
                    return;
                  }
                  setState((current) => ({
                    ...buildInitialFormState({
                      entry: nextEntry,
                      account: null,
                      agentOptions,
                    }),
                    accountKey: current?.accountKey ?? "",
                  }));
                  setFieldErrors({});
                }}
              >
                {registry.map((candidate) => (
                  <option key={candidate.channel} value={candidate.channel}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
            ) : null}

            <Input
              label="Account key"
              data-testid="channels-account-account-key"
              value={state.accountKey}
              readOnly={Boolean(account)}
              required
              error={
                accountKeyConflict
                  ? "An account with this channel and key already exists."
                  : fieldErrorText("account_key")
              }
              onChange={(event) => {
                setState((current) =>
                  current
                    ? {
                        ...current,
                        accountKey: event.currentTarget.value,
                      }
                    : current,
                );
                setFieldErrors((current) => clearChannelFieldError(current, "account_key"));
              }}
            />

            <ChannelFieldSections
              entry={entry}
              state={state}
              account={account}
              agentOptions={agentOptions}
              fieldErrorText={fieldErrorText}
              setState={setState}
              setFieldErrors={setFieldErrors}
            />

            {errorMessage ? (
              <Alert variant="error" title="Unable to save channel" description={errorMessage} />
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
            <Button
              data-testid="channels-account-save"
              isLoading={saving}
              disabled={!state || !entry || !state.accountKey.trim() || Boolean(accountKeyConflict)}
              onClick={() => {
                void save();
              }}
            >
              {account ? "Save changes" : "Add channel"}
            </Button>
          </ElevatedModeTooltip>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
