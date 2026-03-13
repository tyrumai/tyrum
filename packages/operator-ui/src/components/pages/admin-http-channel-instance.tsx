import { ChevronDown, ChevronRight, Save, Trash2 } from "lucide-react";
import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import {
  asChannelRoutingApi,
  buildTelegramChannelCreateInput,
  buildTelegramChannelUpdateInput,
  formatAllowedUserIds,
  isTelegramChannelConfig,
  parseAllowedUserIds,
  sameStringList,
  type TelegramChannelConfig,
} from "./admin-http-channels.shared.js";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
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
import { TelegramChannelFields } from "./admin-http-channel-fields.js";

export function TelegramChannelCard({
  config,
  expanded,
  onToggle,
  onUpdated,
  onDeleted,
  onChannelConfigsChanged,
  mutationApi,
  canMutate,
  requestEnter,
}: {
  config: TelegramChannelConfig;
  expanded: boolean;
  onToggle: () => void;
  onUpdated: (nextConfig: TelegramChannelConfig) => void;
  onDeleted: (accountKey: string) => void;
  onChannelConfigsChanged?: () => void;
  mutationApi: ReturnType<typeof asChannelRoutingApi>;
  canMutate: boolean;
  requestEnter: () => void;
}): React.ReactElement {
  const [botTokenRaw, setBotTokenRaw] = React.useState("");
  const [webhookSecretRaw, setWebhookSecretRaw] = React.useState("");
  const [clearBotToken, setClearBotToken] = React.useState(false);
  const [clearWebhookSecret, setClearWebhookSecret] = React.useState(false);
  const [allowedUserIdsRaw, setAllowedUserIdsRaw] = React.useState("");
  const [pipelineEnabled, setPipelineEnabled] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    setBotTokenRaw("");
    setWebhookSecretRaw("");
    setClearBotToken(false);
    setClearWebhookSecret(false);
    setAllowedUserIdsRaw(formatAllowedUserIds(config.allowed_user_ids));
    setPipelineEnabled(config.pipeline_enabled);
  }, [
    config.account_key,
    config.allowed_user_ids,
    config.pipeline_enabled,
    config.bot_token_configured,
    config.webhook_secret_configured,
  ]);

  const parsedAllowedUserIds = React.useMemo(
    () => parseAllowedUserIds(allowedUserIdsRaw),
    [allowedUserIdsRaw],
  );
  const validationError =
    parsedAllowedUserIds.invalid.length > 0
      ? `User IDs must be numeric. Invalid: ${parsedAllowedUserIds.invalid.join(", ")}`
      : null;
  const isDirty =
    !sameStringList(parsedAllowedUserIds.ids, config.allowed_user_ids) ||
    pipelineEnabled !== config.pipeline_enabled ||
    botTokenRaw.trim().length > 0 ||
    webhookSecretRaw.trim().length > 0 ||
    clearBotToken ||
    clearWebhookSecret;

  const saveConfig = async (): Promise<void> => {
    if (!mutationApi?.updateChannelConfig) {
      throw new Error("Channels config API unavailable.");
    }
    if (!canMutate) {
      requestEnter();
      throw new Error("Authorize admin access to change channel settings.");
    }
    if (validationError) {
      throw new Error(validationError);
    }

    setSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const result = await mutationApi.updateChannelConfig(
        "telegram",
        config.account_key,
        buildTelegramChannelUpdateInput({
          botTokenRaw,
          clearBotToken,
          webhookSecretRaw,
          clearWebhookSecret,
          allowedUserIds: parsedAllowedUserIds.ids,
          pipelineEnabled,
        }),
      );
      if (!isTelegramChannelConfig(result.config)) {
        throw new Error("Unexpected channel config response.");
      }
      onUpdated(result.config);
      onChannelConfigsChanged?.();
      setStatusMessage(`Saved Telegram account ${result.config.account_key}.`);
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const deleteConfig = async (): Promise<void> => {
    if (!mutationApi?.deleteChannelConfig) {
      throw new Error("Channels config API unavailable.");
    }
    const result = await mutationApi.deleteChannelConfig("telegram", config.account_key);
    onDeleted(result.account_key);
    onChannelConfigsChanged?.();
  };

  return (
    <Card data-testid={`channels-instance-card-${config.account_key}`}>
      <CardHeader className="pb-2.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <button
            type="button"
            data-testid={`channels-instance-toggle-${config.account_key}`}
            className="flex min-w-0 flex-1 items-start gap-3 text-left"
            onClick={onToggle}
          >
            {expanded ? (
              <ChevronDown className="mt-0.5 h-4 w-4 text-fg-muted" aria-hidden="true" />
            ) : (
              <ChevronRight className="mt-0.5 h-4 w-4 text-fg-muted" aria-hidden="true" />
            )}
            <div className="grid min-w-0 gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">telegram</Badge>
                <div className="text-sm font-medium text-fg">{config.account_key}</div>
              </div>
              <div className="text-sm text-fg-muted">
                {expanded
                  ? "Edit the Telegram credentials, allowlist, and queue settings for this account."
                  : "Collapsed. Expand to review or change this Telegram account configuration."}
              </div>
            </div>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={config.bot_token_configured ? "success" : "outline"}>
              Bot token {config.bot_token_configured ? "configured" : "missing"}
            </Badge>
            <Badge variant={config.webhook_secret_configured ? "success" : "outline"}>
              Webhook secret {config.webhook_secret_configured ? "configured" : "missing"}
            </Badge>
            <Badge variant={config.pipeline_enabled ? "success" : "outline"}>
              Pipeline {config.pipeline_enabled ? "enabled" : "disabled"}
            </Badge>
          </div>
        </div>
      </CardHeader>

      {expanded ? (
        <CardContent className="grid gap-4">
          {statusMessage ? (
            <Alert variant="success" title="Channel updated" description={statusMessage} />
          ) : null}
          {errorMessage ? (
            <Alert variant="error" title="Unable to update channel" description={errorMessage} />
          ) : null}

          <TelegramChannelFields
            testIdPrefix={`channels-instance-${config.account_key}`}
            allowSecretClears={true}
            validationError={validationError}
            botTokenRaw={botTokenRaw}
            clearBotToken={clearBotToken}
            webhookSecretRaw={webhookSecretRaw}
            clearWebhookSecret={clearWebhookSecret}
            allowedUserIdsRaw={allowedUserIdsRaw}
            pipelineEnabled={pipelineEnabled}
            onBotTokenChange={setBotTokenRaw}
            onClearBotTokenChange={setClearBotToken}
            onWebhookSecretChange={setWebhookSecretRaw}
            onClearWebhookSecretChange={setClearWebhookSecret}
            onAllowedUserIdsChange={setAllowedUserIdsRaw}
            onPipelineEnabledChange={setPipelineEnabled}
          />

          <div className="flex flex-wrap justify-end gap-2">
            <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
              <Button
                variant="danger"
                data-testid={`channels-instance-delete-open-${config.account_key}`}
                onClick={() => {
                  if (!canMutate) {
                    requestEnter();
                    return;
                  }
                  setDeleteDialogOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </ElevatedModeTooltip>
            <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
              <Button
                data-testid={`channels-instance-save-${config.account_key}`}
                isLoading={saving}
                disabled={!isDirty || Boolean(validationError)}
                onClick={() => {
                  void saveConfig();
                }}
              >
                <Save className="h-4 w-4" />
                Save
              </Button>
            </ElevatedModeTooltip>
          </div>

          <ConfirmDangerDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            title="Delete channel configuration"
            description={`Remove the Telegram account ${config.account_key}. Existing routing rules are not deleted automatically.`}
            confirmLabel="Delete channel"
            onConfirm={deleteConfig}
          />
        </CardContent>
      ) : null}
    </Card>
  );
}

export function CreateChannelDialog({
  open,
  onOpenChange,
  onCreated,
  mutationApi,
  canMutate,
  requestEnter,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (config: TelegramChannelConfig) => void;
  mutationApi: ReturnType<typeof asChannelRoutingApi>;
  canMutate: boolean;
  requestEnter: () => void;
}): React.ReactElement {
  const [channelType, setChannelType] = React.useState<"telegram">("telegram");
  const [accountKey, setAccountKey] = React.useState("");
  const [botTokenRaw, setBotTokenRaw] = React.useState("");
  const [webhookSecretRaw, setWebhookSecretRaw] = React.useState("");
  const [allowedUserIdsRaw, setAllowedUserIdsRaw] = React.useState("");
  const [pipelineEnabled, setPipelineEnabled] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) return;
    setChannelType("telegram");
    setAccountKey("");
    setBotTokenRaw("");
    setWebhookSecretRaw("");
    setAllowedUserIdsRaw("");
    setPipelineEnabled(true);
    setSaving(false);
    setErrorMessage(null);
  }, [open]);

  const parsedAllowedUserIds = React.useMemo(
    () => parseAllowedUserIds(allowedUserIdsRaw),
    [allowedUserIdsRaw],
  );
  const validationError =
    parsedAllowedUserIds.invalid.length > 0
      ? `User IDs must be numeric. Invalid: ${parsedAllowedUserIds.invalid.join(", ")}`
      : null;
  const canSave =
    canMutate && accountKey.trim().length > 0 && !validationError && channelType === "telegram";

  const createConfig = async (): Promise<void> => {
    if (!mutationApi?.createChannelConfig) {
      throw new Error("Channels config API unavailable.");
    }
    if (!canMutate) {
      requestEnter();
      throw new Error("Authorize admin access to add a channel.");
    }
    if (validationError) {
      throw new Error(validationError);
    }

    setSaving(true);
    setErrorMessage(null);
    try {
      const result = await mutationApi.createChannelConfig(
        buildTelegramChannelCreateInput({
          accountKey,
          botTokenRaw,
          webhookSecretRaw,
          allowedUserIds: parsedAllowedUserIds.ids,
          pipelineEnabled,
        }),
      );
      if (!isTelegramChannelConfig(result.config)) {
        throw new Error("Unexpected channel config response.");
      }
      onCreated(result.config);
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="channels-instance-create-dialog">
        <DialogHeader>
          <DialogTitle>Add channel</DialogTitle>
          <DialogDescription>
            Configure a new channel instance. Telegram is the only channel type available in this
            build.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Select
            label="Channel type"
            data-testid="channels-instance-create-channel"
            value={channelType}
            onChange={(event) => {
              setChannelType(event.currentTarget.value as "telegram");
            }}
          >
            <option value="telegram">Telegram</option>
          </Select>

          <Input
            label="Account key"
            data-testid="channels-instance-create-account-key"
            value={accountKey}
            helperText="Use a stable, unique account key for this Telegram channel instance."
            onChange={(event) => {
              setAccountKey(event.currentTarget.value);
            }}
          />

          <TelegramChannelFields
            testIdPrefix="channels-instance-create"
            allowSecretClears={false}
            validationError={validationError}
            botTokenRaw={botTokenRaw}
            clearBotToken={false}
            webhookSecretRaw={webhookSecretRaw}
            clearWebhookSecret={false}
            allowedUserIdsRaw={allowedUserIdsRaw}
            pipelineEnabled={pipelineEnabled}
            onBotTokenChange={setBotTokenRaw}
            onClearBotTokenChange={() => {}}
            onWebhookSecretChange={setWebhookSecretRaw}
            onClearWebhookSecretChange={() => {}}
            onAllowedUserIdsChange={setAllowedUserIdsRaw}
            onPipelineEnabledChange={setPipelineEnabled}
          />

          {errorMessage ? (
            <Alert variant="error" title="Unable to add channel" description={errorMessage} />
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="channels-instance-create-save"
            isLoading={saving}
            disabled={!canSave}
            onClick={() => {
              void createConfig();
            }}
          >
            Add channel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
