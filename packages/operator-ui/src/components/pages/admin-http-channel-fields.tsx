import * as React from "react";
import { Checkbox } from "../ui/checkbox.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Select } from "../ui/select.js";
import { Switch } from "../ui/switch.js";
import { Textarea } from "../ui/textarea.js";

function TelegramSecretField({
  label,
  inputTestId,
  clearTestId,
  showClear,
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
  showClear: boolean;
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
        disabled={showClear && clearValue}
        helperText={helperText}
        onChange={(event) => {
          onValueChange(event.currentTarget.value);
        }}
      />

      {showClear ? (
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
      ) : null}
    </>
  );
}

export function TelegramChannelFields({
  testIdPrefix,
  allowSecretClears,
  validationError,
  ingressMode,
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
  onIngressModeChange,
}: {
  testIdPrefix: string;
  allowSecretClears: boolean;
  validationError: string | null;
  ingressMode: "webhook" | "polling";
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
  onIngressModeChange: (value: "webhook" | "polling") => void;
}): React.ReactElement {
  return (
    <>
      <Select
        label="Ingress mode"
        data-testid={`${testIdPrefix}-ingress-mode`}
        value={ingressMode}
        helperText="Use long polling for local/private setups. Use webhook mode when Telegram can reach Tyrum over HTTPS."
        onChange={(event) => {
          onIngressModeChange(event.currentTarget.value as "webhook" | "polling");
        }}
      >
        <option value="polling">Long polling</option>
        <option value="webhook">Webhook</option>
      </Select>

      <TelegramSecretField
        label="Bot token"
        inputTestId={`${testIdPrefix}-bot-token`}
        clearTestId={`${testIdPrefix}-clear-bot-token`}
        showClear={allowSecretClears}
        value={botTokenRaw}
        clearValue={clearBotToken}
        helperText={
          allowSecretClears
            ? "Leave blank to keep the saved token. Set “Remove saved bot token” to clear it."
            : "Optional. Leave blank to create the account without a saved bot token."
        }
        clearLabel="Remove saved bot token"
        onValueChange={onBotTokenChange}
        onClearChange={onClearBotTokenChange}
      />

      {ingressMode === "webhook" ? (
        <TelegramSecretField
          label="Webhook secret"
          inputTestId={`${testIdPrefix}-webhook-secret`}
          clearTestId={`${testIdPrefix}-clear-webhook-secret`}
          showClear={allowSecretClears}
          value={webhookSecretRaw}
          clearValue={clearWebhookSecret}
          helperText={
            allowSecretClears
              ? "Leave blank to keep the saved secret. Tyrum requires this secret for Telegram webhook validation."
              : "Required in webhook mode. Tyrum validates incoming Telegram webhooks with this secret."
          }
          clearLabel="Remove saved webhook secret"
          onValueChange={onWebhookSecretChange}
          onClearChange={onClearWebhookSecretChange}
        />
      ) : null}

      <Textarea
        label="Allowed Telegram user IDs"
        data-testid={`${testIdPrefix}-allowed-user-ids`}
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
        <Label htmlFor={`${testIdPrefix}-pipeline-enabled`}>Channel pipeline</Label>
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <div className="grid gap-0.5">
            <div className="text-sm text-fg">Enable Telegram queueing and delivery pipeline</div>
            <div className="text-sm text-fg-muted">
              Turn off to stop using the Telegram channel queue immediately for this account.
            </div>
          </div>
          <Switch
            id={`${testIdPrefix}-pipeline-enabled`}
            data-testid={`${testIdPrefix}-pipeline-enabled`}
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
