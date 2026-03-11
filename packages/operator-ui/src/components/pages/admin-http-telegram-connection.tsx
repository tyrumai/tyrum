import type { OperatorCore } from "@tyrum/operator-core";
import { RefreshCw, Save } from "lucide-react";
import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Checkbox } from "../ui/checkbox.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Switch } from "../ui/switch.js";
import { Textarea } from "../ui/textarea.js";
import { useAdminHttpClient, useAdminMutationAccess } from "./admin-http-shared.js";

type TelegramConnectionApi = NonNullable<OperatorCore["http"]["routingConfig"]>;
type TelegramConnectionConfig = Awaited<
  ReturnType<TelegramConnectionApi["getTelegramConfig"]>
>["config"];

type ParsedUserIds = {
  ids: string[];
  invalid: string[];
};

function parseAllowedUserIds(raw: string): ParsedUserIds {
  const seen = new Set<string>();
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const token of raw.split(/[\s,]+/)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    if (!/^[0-9]+$/.test(trimmed)) {
      invalid.push(trimmed);
      continue;
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    ids.push(trimmed);
  }
  return { ids, invalid };
}

function formatAllowedUserIds(userIds: readonly string[]): string {
  return userIds.join("\n");
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function TelegramSecretField({
  label,
  inputTestId,
  clearTestId,
  value,
  clearValue,
  helperText,
  clearLabel,
  onValueChange,
  onClearChange,
}: {
  label: string;
  inputTestId: string;
  clearTestId: string;
  value: string;
  clearValue: boolean;
  helperText: string;
  clearLabel: string;
  onValueChange: (value: string) => void;
  onClearChange: (value: boolean) => void;
}): React.ReactElement {
  return (
    <>
      <Input
        label={label}
        type="password"
        data-testid={inputTestId}
        value={value}
        disabled={clearValue}
        helperText={helperText}
        onChange={(event) => {
          onValueChange(event.currentTarget.value);
        }}
      />

      <label className="flex items-center gap-3 text-sm text-fg">
        <Checkbox
          data-testid={clearTestId}
          checked={clearValue}
          onCheckedChange={(checked) => {
            onClearChange(Boolean(checked));
          }}
        />
        <span>{clearLabel}</span>
      </label>
    </>
  );
}

function TelegramConnectionFields({
  validationError,
  botTokenRaw,
  clearBotToken,
  webhookSecretRaw,
  clearWebhookSecret,
  allowedUserIdsRaw,
  pipelineEnabled,
  onBotTokenChange,
  onClearBotTokenChange,
  onWebhookSecretChange,
  onClearWebhookSecretChange,
  onAllowedUserIdsChange,
  onPipelineEnabledChange,
}: {
  validationError: string | null;
  botTokenRaw: string;
  clearBotToken: boolean;
  webhookSecretRaw: string;
  clearWebhookSecret: boolean;
  allowedUserIdsRaw: string;
  pipelineEnabled: boolean;
  onBotTokenChange: (value: string) => void;
  onClearBotTokenChange: (value: boolean) => void;
  onWebhookSecretChange: (value: string) => void;
  onClearWebhookSecretChange: (value: boolean) => void;
  onAllowedUserIdsChange: (value: string) => void;
  onPipelineEnabledChange: (value: boolean) => void;
}): React.ReactElement {
  return (
    <>
      <TelegramSecretField
        label="Bot token"
        inputTestId="channels-telegram-bot-token"
        clearTestId="channels-telegram-clear-bot-token"
        value={botTokenRaw}
        clearValue={clearBotToken}
        helperText="Leave blank to keep the saved token. Set “Remove saved bot token” to clear it."
        clearLabel="Remove saved bot token"
        onValueChange={onBotTokenChange}
        onClearChange={onClearBotTokenChange}
      />

      <TelegramSecretField
        label="Webhook secret"
        inputTestId="channels-telegram-webhook-secret"
        clearTestId="channels-telegram-clear-webhook-secret"
        value={webhookSecretRaw}
        clearValue={clearWebhookSecret}
        helperText="Leave blank to keep the saved secret. Tyrum requires this secret for Telegram webhook validation."
        clearLabel="Remove saved webhook secret"
        onValueChange={onWebhookSecretChange}
        onClearChange={onClearWebhookSecretChange}
      />

      <Textarea
        label="Allowed Telegram user IDs"
        data-testid="channels-telegram-allowed-user-ids"
        value={allowedUserIdsRaw}
        error={validationError}
        helperText={
          validationError
            ? undefined
            : "Optional. Enter numeric Telegram user IDs separated by newlines or commas. When empty, any sender is allowed."
        }
        placeholder="123456789"
        onChange={(event) => {
          onAllowedUserIdsChange(event.currentTarget.value);
        }}
      />

      <div className="grid gap-1.5">
        <Label htmlFor="channels-telegram-pipeline-enabled">Channel pipeline</Label>
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <div className="grid gap-0.5">
            <div className="text-sm text-fg">Enable Telegram queueing and delivery pipeline</div>
            <div className="text-sm text-fg-muted">
              Turn off to keep Telegram ingress from using the channel queue on the next restart.
            </div>
          </div>
          <Switch
            id="channels-telegram-pipeline-enabled"
            data-testid="channels-telegram-pipeline-enabled"
            checked={pipelineEnabled}
            onCheckedChange={(checked) => {
              onPipelineEnabledChange(Boolean(checked));
            }}
          />
        </div>
      </div>
    </>
  );
}

function TelegramConnectionConfirmDetails({
  clearBotToken,
  botTokenRaw,
  clearWebhookSecret,
  webhookSecretRaw,
  allowedUserCount,
  pipelineEnabled,
}: {
  clearBotToken: boolean;
  botTokenRaw: string;
  clearWebhookSecret: boolean;
  webhookSecretRaw: string;
  allowedUserCount: number;
  pipelineEnabled: boolean;
}): React.ReactElement {
  return (
    <div className="grid gap-2 text-sm text-fg-muted">
      <div>
        Bot token:{" "}
        {clearBotToken
          ? "remove saved token"
          : botTokenRaw.trim()
            ? "replace token"
            : "keep current"}
      </div>
      <div>
        Webhook secret:{" "}
        {clearWebhookSecret
          ? "remove saved secret"
          : webhookSecretRaw.trim()
            ? "replace secret"
            : "keep current"}
      </div>
      <div>Allowed users: {allowedUserCount}</div>
      <div>Pipeline enabled: {pipelineEnabled ? "yes" : "no"}</div>
    </div>
  );
}

function TelegramConnectionAlerts({
  statusMessage,
}: {
  statusMessage: string | null;
}): React.ReactElement {
  return (
    <>
      <Alert
        variant="info"
        title="Restart required"
        description="Telegram connection changes are stored in deployment config. The running gateway reads them on startup, so restart after saving. Secret values remain write-only."
      />

      {statusMessage ? (
        <Alert variant="success" title="Telegram updated" description={statusMessage} />
      ) : null}
    </>
  );
}

function TelegramConnectionHeader({
  currentConfig,
  revision,
  refreshing,
  canMutate,
  requestEnter,
  isDirty,
  validationError,
  onRefresh,
  onSaveOpen,
}: {
  currentConfig: TelegramConnectionConfig | null;
  revision: number;
  refreshing: boolean;
  canMutate: boolean;
  requestEnter: () => void;
  isDirty: boolean;
  validationError: string | null;
  onRefresh: () => void;
  onSaveOpen: () => void;
}): React.ReactElement {
  return (
    <CardHeader className="pb-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-sm font-medium text-fg">Telegram connection</div>
          <div className="text-sm text-fg-muted">
            Configure the bot credentials and optional sender allowlist for the built-in Telegram
            connector.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={currentConfig?.bot_token_configured ? "success" : "outline"}>
            Bot token {currentConfig?.bot_token_configured ? "configured" : "missing"}
          </Badge>
          <Badge variant={currentConfig?.webhook_secret_configured ? "success" : "outline"}>
            Webhook secret {currentConfig?.webhook_secret_configured ? "configured" : "missing"}
          </Badge>
          <Badge variant="outline">Revision {revision}</Badge>
          <Button
            variant="secondary"
            data-testid="channels-telegram-refresh"
            isLoading={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
            <Button
              data-testid="channels-telegram-save-open"
              disabled={!isDirty || Boolean(validationError)}
              onClick={onSaveOpen}
            >
              <Save className="h-4 w-4" />
              Save
            </Button>
          </ElevatedModeTooltip>
        </div>
      </div>
    </CardHeader>
  );
}

export function AdminHttpTelegramConnectionPanel({
  core,
}: {
  core: OperatorCore;
}): React.ReactElement {
  const readApi = core.http.routingConfig;
  const mutationApi = (useAdminHttpClient() ?? core.http).routingConfig;
  const { canMutate, requestEnter } = useAdminMutationAccess(core);

  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [currentConfig, setCurrentConfig] = React.useState<TelegramConnectionConfig | null>(null);
  const [revision, setRevision] = React.useState(0);
  const [botTokenRaw, setBotTokenRaw] = React.useState("");
  const [webhookSecretRaw, setWebhookSecretRaw] = React.useState("");
  const [clearBotToken, setClearBotToken] = React.useState(false);
  const [clearWebhookSecret, setClearWebhookSecret] = React.useState(false);
  const [allowedUserIdsRaw, setAllowedUserIdsRaw] = React.useState("");
  const [pipelineEnabled, setPipelineEnabled] = React.useState(true);

  const refreshConfig = React.useCallback(async (): Promise<void> => {
    if (!readApi?.getTelegramConfig) {
      setErrorMessage("Telegram connection config API unavailable.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setRefreshing(true);
    setErrorMessage(null);
    try {
      const result = await readApi.getTelegramConfig();
      setCurrentConfig(result.config);
      setRevision(result.revision);
      setBotTokenRaw("");
      setWebhookSecretRaw("");
      setClearBotToken(false);
      setClearWebhookSecret(false);
      setAllowedUserIdsRaw(formatAllowedUserIds(result.config.allowed_user_ids));
      setPipelineEnabled(result.config.pipeline_enabled);
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [readApi]);

  React.useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  const parsedAllowedUserIds = React.useMemo(
    () => parseAllowedUserIds(allowedUserIdsRaw),
    [allowedUserIdsRaw],
  );
  const validationError =
    parsedAllowedUserIds.invalid.length > 0
      ? `User IDs must be numeric. Invalid: ${parsedAllowedUserIds.invalid.join(", ")}`
      : null;
  const isDirty =
    currentConfig !== null &&
    (!sameStringList(parsedAllowedUserIds.ids, currentConfig.allowed_user_ids) ||
      pipelineEnabled !== currentConfig.pipeline_enabled ||
      botTokenRaw.trim().length > 0 ||
      webhookSecretRaw.trim().length > 0 ||
      clearBotToken ||
      clearWebhookSecret);
  const canSave = canMutate && !saving && !validationError && isDirty;

  const saveConfig = async (): Promise<void> => {
    if (!mutationApi?.updateTelegramConfig) {
      throw new Error("Telegram connection config API unavailable.");
    }
    if (!canMutate) {
      requestEnter();
      throw new Error("Enter Elevated Mode to change Telegram connection settings.");
    }
    if (validationError) {
      throw new Error(validationError);
    }

    setSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await mutationApi.updateTelegramConfig({
        ...(botTokenRaw.trim() ? { bot_token: botTokenRaw.trim() } : {}),
        ...(webhookSecretRaw.trim() ? { webhook_secret: webhookSecretRaw.trim() } : {}),
        ...(clearBotToken ? { clear_bot_token: true } : {}),
        ...(clearWebhookSecret ? { clear_webhook_secret: true } : {}),
        allowed_user_ids: parsedAllowedUserIds.ids,
        pipeline_enabled: pipelineEnabled,
      });
      setStatusMessage("Telegram connection settings saved. Restart the gateway to apply them.");
      await refreshConfig();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4" data-testid="admin-http-telegram-connection">
      <TelegramConnectionAlerts statusMessage={statusMessage} />

      <Card>
        <TelegramConnectionHeader
          currentConfig={currentConfig}
          revision={revision}
          refreshing={refreshing}
          canMutate={canMutate}
          requestEnter={requestEnter}
          isDirty={isDirty}
          validationError={validationError}
          onRefresh={() => {
            void refreshConfig();
          }}
          onSaveOpen={() => {
            if (!canMutate) {
              requestEnter();
              return;
            }
            setDialogOpen(true);
          }}
        />
        <CardContent className="grid gap-4">
          {errorMessage ? (
            <Alert variant="error" title="Telegram config failed" description={errorMessage} />
          ) : null}

          {loading ? (
            <div className="text-sm text-fg-muted">Loading Telegram connection…</div>
          ) : null}

          <TelegramConnectionFields
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
        </CardContent>
      </Card>

      <ConfirmDangerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Save Telegram connection settings"
        description="This writes a new deployment-config revision. Restart the gateway after saving to apply Telegram credential or allowlist changes."
        confirmLabel="Save settings"
        confirmDisabled={!canSave}
        onConfirm={saveConfig}
      >
        <TelegramConnectionConfirmDetails
          clearBotToken={clearBotToken}
          botTokenRaw={botTokenRaw}
          clearWebhookSecret={clearWebhookSecret}
          webhookSecretRaw={webhookSecretRaw}
          allowedUserCount={parsedAllowedUserIds.ids.length}
          pipelineEnabled={pipelineEnabled}
        />
      </ConfirmDangerDialog>
    </div>
  );
}
