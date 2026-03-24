import * as React from "react";
import { translateString, useI18n, useTranslateNode } from "../../i18n-helpers.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Checkbox } from "../ui/checkbox.js";
import { Input } from "../ui/input.js";

export function FieldGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const translateNode = useTranslateNode();
  return (
    <Card>
      <CardHeader className="pb-2.5">
        <div className="text-sm font-medium text-fg">{translateNode(title)}</div>
        <div className="text-sm text-fg-muted">{translateNode(description)}</div>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

export function ToggleField({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const translateNode = useTranslateNode();
  return (
    <label className="flex items-center gap-3 text-sm text-fg">
      <Checkbox
        checked={checked}
        onCheckedChange={(nextChecked) => {
          onCheckedChange(Boolean(nextChecked));
        }}
      />
      <span>{translateNode(label)}</span>
    </label>
  );
}

export function BudgetInputs({
  prefix,
  itemsValue,
  charsValue,
  tokensValue,
  onChange,
}: {
  prefix: string;
  itemsValue: string;
  charsValue: string;
  tokensValue: string;
  onChange: (field: string, value: string) => void;
}) {
  const intl = useI18n();
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Input
        label={translateString(intl, "{prefix} items", { prefix })}
        value={itemsValue}
        onChange={(event) => {
          onChange("items", event.currentTarget.value);
        }}
      />
      <Input
        label={translateString(intl, "{prefix} chars", { prefix })}
        value={charsValue}
        onChange={(event) => {
          onChange("chars", event.currentTarget.value);
        }}
      />
      <Input
        label={translateString(intl, "{prefix} tokens", { prefix })}
        value={tokensValue}
        helperText={translateString(intl, "Leave blank to keep unset.")}
        onChange={(event) => {
          onChange("tokens", event.currentTarget.value);
        }}
      />
    </div>
  );
}
