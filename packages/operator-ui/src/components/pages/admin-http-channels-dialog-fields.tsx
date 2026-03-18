import * as React from "react";
import { Checkbox } from "../ui/checkbox.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { Switch } from "../ui/switch.js";
import { Textarea } from "../ui/textarea.js";
import {
  SECTION_LABELS,
  clearChannelFieldError,
  getFieldOptions,
  renderFieldHelper,
  shouldShowField,
  type AgentOption,
  type ChannelFieldErrors,
  type ChannelFormState,
  type ChannelRegistryEntry,
  type ConfiguredChannelAccount,
} from "./admin-http-channels-shared.js";

type FieldErrorText = (fieldKey: string) => string | null;
type SetChannelFormState = React.Dispatch<React.SetStateAction<ChannelFormState | null>>;
type SetChannelFieldErrors = React.Dispatch<React.SetStateAction<ChannelFieldErrors>>;

function updateConfigValue(
  setState: SetChannelFormState,
  key: string,
  value: string | boolean,
): void {
  setState((current) =>
    current
      ? {
          ...current,
          configValues: {
            ...current.configValues,
            [key]: value,
          },
        }
      : current,
  );
}

function updateSecretValue(setState: SetChannelFormState, key: string, value: string): void {
  setState((current) =>
    current
      ? {
          ...current,
          secretValues: {
            ...current.secretValues,
            [key]: value,
          },
        }
      : current,
  );
}

function updateClearSecret(setState: SetChannelFormState, key: string, checked: boolean): void {
  setState((current) =>
    current
      ? {
          ...current,
          clearSecretKeys: {
            ...current.clearSecretKeys,
            [key]: checked,
          },
        }
      : current,
  );
}

function clearFieldError(setFieldErrors: SetChannelFieldErrors, fieldKey: string): void {
  setFieldErrors((current) => clearChannelFieldError(current, fieldKey));
}

function ChannelSecretField(props: {
  field: ChannelRegistryEntry["fields"][number];
  state: ChannelFormState;
  account: ConfiguredChannelAccount | null;
  fieldErrorText: FieldErrorText;
  setState: SetChannelFormState;
  setFieldErrors: SetChannelFieldErrors;
}) {
  const { account, field, fieldErrorText, setFieldErrors, setState, state } = props;
  const helperText = renderFieldHelper(field);
  const clearChecked = state.clearSecretKeys[field.key] === true;
  const sharedProps = {
    label: field.label,
    "data-testid": `channels-account-field-${field.key}`,
    required: !account && field.required,
    disabled: account ? clearChecked : false,
    error: fieldErrorText(field.key),
    helperText:
      account && field.required ? (
        <div className="grid gap-1">
          <span>Leave blank to keep the saved secret.</span>
          {helperText}
        </div>
      ) : (
        helperText
      ),
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      updateSecretValue(setState, field.key, event.currentTarget.value);
      clearFieldError(setFieldErrors, field.key);
    },
  };

  return (
    <div className="grid gap-2">
      {field.input === "textarea" ? (
        <Textarea {...sharedProps} value={state.secretValues[field.key] ?? ""} />
      ) : (
        <Input {...sharedProps} type="password" value={state.secretValues[field.key] ?? ""} />
      )}

      {account && !field.required ? (
        <label className="flex items-center gap-3 text-sm text-fg">
          <Checkbox
            data-testid={`channels-account-clear-${field.key}`}
            checked={clearChecked}
            onCheckedChange={(checked) => {
              updateClearSecret(setState, field.key, checked === true);
            }}
          />
          <span>Remove saved {field.label.toLowerCase()}</span>
        </label>
      ) : null}
    </div>
  );
}

function ChannelConfigField(props: {
  field: ChannelRegistryEntry["fields"][number];
  state: ChannelFormState;
  agentOptions: readonly AgentOption[];
  fieldErrorText: FieldErrorText;
  setState: SetChannelFormState;
  setFieldErrors: SetChannelFieldErrors;
}) {
  const { agentOptions, field, fieldErrorText, setFieldErrors, setState, state } = props;
  const helperText = renderFieldHelper(field);

  if (field.input === "boolean") {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-3">
        <div className="grid gap-1">
          <div className="text-sm font-medium text-fg">{field.label}</div>
          {helperText ? <div className="text-sm text-fg-muted">{helperText}</div> : null}
        </div>
        <Switch
          data-testid={`channels-account-field-${field.key}`}
          checked={state.configValues[field.key] === true}
          onCheckedChange={(checked) => {
            updateConfigValue(setState, field.key, checked === true);
            clearFieldError(setFieldErrors, field.key);
          }}
        />
      </div>
    );
  }

  if (field.input === "select") {
    const options = getFieldOptions(field, agentOptions);
    return (
      <Select
        label={field.label}
        data-testid={`channels-account-field-${field.key}`}
        helperText={helperText}
        error={fieldErrorText(field.key)}
        required={field.required}
        value={String(state.configValues[field.key] ?? "")}
        onChange={(event) => {
          updateConfigValue(setState, field.key, event.currentTarget.value);
          clearFieldError(setFieldErrors, field.key);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    );
  }

  if (field.input === "textarea") {
    return (
      <Textarea
        label={field.label}
        data-testid={`channels-account-field-${field.key}`}
        helperText={helperText}
        error={fieldErrorText(field.key)}
        required={field.required}
        placeholder={field.placeholder ?? undefined}
        value={String(state.configValues[field.key] ?? "")}
        onChange={(event) => {
          updateConfigValue(setState, field.key, event.currentTarget.value);
          clearFieldError(setFieldErrors, field.key);
        }}
      />
    );
  }

  return (
    <Input
      label={field.label}
      data-testid={`channels-account-field-${field.key}`}
      helperText={helperText}
      error={fieldErrorText(field.key)}
      required={field.required}
      placeholder={field.placeholder ?? undefined}
      value={String(state.configValues[field.key] ?? "")}
      onChange={(event) => {
        updateConfigValue(setState, field.key, event.currentTarget.value);
        clearFieldError(setFieldErrors, field.key);
      }}
    />
  );
}

function ChannelFieldControl(props: {
  field: ChannelRegistryEntry["fields"][number];
  state: ChannelFormState;
  account: ConfiguredChannelAccount | null;
  agentOptions: readonly AgentOption[];
  fieldErrorText: FieldErrorText;
  setState: SetChannelFormState;
  setFieldErrors: SetChannelFieldErrors;
}) {
  const { account, agentOptions, field, fieldErrorText, setFieldErrors, setState, state } = props;
  if (field.kind === "secret") {
    return (
      <ChannelSecretField
        field={field}
        state={state}
        account={account}
        fieldErrorText={fieldErrorText}
        setState={setState}
        setFieldErrors={setFieldErrors}
      />
    );
  }
  return (
    <ChannelConfigField
      field={field}
      state={state}
      agentOptions={agentOptions}
      fieldErrorText={fieldErrorText}
      setState={setState}
      setFieldErrors={setFieldErrors}
    />
  );
}

export function ChannelFieldSections(props: {
  entry: ChannelRegistryEntry;
  state: ChannelFormState;
  account: ConfiguredChannelAccount | null;
  agentOptions: readonly AgentOption[];
  fieldErrorText: FieldErrorText;
  setState: SetChannelFormState;
  setFieldErrors: SetChannelFieldErrors;
}) {
  const { account, agentOptions, entry, fieldErrorText, setFieldErrors, setState, state } = props;
  return (
    <>
      {(["credentials", "access", "delivery", "advanced"] as const).map((sectionKey) => {
        const fields = entry.fields.filter(
          (field) => field.section === sectionKey && shouldShowField(field, state),
        );
        if (fields.length === 0) {
          return null;
        }
        return (
          <div key={sectionKey} className="grid gap-3 rounded-xl border border-border/70 p-4">
            <div className="text-sm font-medium text-fg">{SECTION_LABELS[sectionKey]}</div>
            {fields.map((field) => (
              <ChannelFieldControl
                key={field.key}
                field={field}
                state={state}
                account={account}
                agentOptions={agentOptions}
                fieldErrorText={fieldErrorText}
                setState={setState}
                setFieldErrors={setFieldErrors}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}
