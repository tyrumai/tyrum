import * as React from "react";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import {
  createBlankKeyNumberRow,
  createBlankKeySensitivityRow,
  type PolicyArtifactsFormState,
  type PolicyKeyNumberRow,
  type PolicyKeySensitivityRow,
} from "./admin-http-policy-shared.js";
import { emptyStringMessage, SectionHeading } from "./admin-http-policy-config-primitives.js";

function isPositiveIntegerInput(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  const value = Number(trimmed);
  return Number.isInteger(value) && value > 0;
}

function numericError(raw: string): string | undefined {
  return isPositiveIntegerInput(raw) ? undefined : "Use a positive whole number.";
}

function PolicyDecisionSelect(props: {
  value: PolicyArtifactsFormState["defaultDecision"];
  onChange: (next: PolicyArtifactsFormState["defaultDecision"]) => void;
}): React.ReactElement {
  return (
    <Select
      label="Default decision"
      helperText="Use allow unless you need to disable artifact capture by default."
      value={props.value}
      onChange={(event) => {
        const next = event.currentTarget.value;
        if (next === "allow" || next === "require_approval" || next === "deny") {
          props.onChange(next);
        }
      }}
    >
      <option value="allow">Allow</option>
      <option value="require_approval">Require approval</option>
      <option value="deny">Deny</option>
    </Select>
  );
}

function KeyNumberRowsEditor(props: {
  title: string;
  description: string;
  rows: PolicyKeyNumberRow[];
  fieldLabel: string;
  testIdPrefix: string;
  onChange: (next: PolicyKeyNumberRow[]) => void;
}): React.ReactElement {
  return (
    <div className="grid gap-3 rounded-lg border border-border p-4">
      <SectionHeading title={props.title} description={props.description} />
      {props.rows.map((row, index) => (
        <div key={row.id} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <Input
            label={`Label ${index + 1}`}
            value={row.key}
            error={emptyStringMessage(row.key)}
            onChange={(event) =>
              props.onChange(
                props.rows.map((candidate) =>
                  candidate.id === row.id
                    ? { ...candidate, key: event.currentTarget.value }
                    : candidate,
                ),
              )
            }
          />
          <Input
            label={props.fieldLabel}
            inputMode="numeric"
            value={row.value}
            error={numericError(row.value)}
            onChange={(event) =>
              props.onChange(
                props.rows.map((candidate) =>
                  candidate.id === row.id
                    ? { ...candidate, value: event.currentTarget.value }
                    : candidate,
                ),
              )
            }
          />
          <div className="flex items-end">
            <Button
              variant="ghost"
              onClick={() =>
                props.onChange(props.rows.filter((candidate) => candidate.id !== row.id))
              }
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button
          variant="secondary"
          data-testid={`${props.testIdPrefix}-add`}
          onClick={() =>
            props.onChange([...props.rows, createBlankKeyNumberRow(props.testIdPrefix)])
          }
        >
          Add row
        </Button>
      </div>
    </div>
  );
}

function KeySensitivityRowsEditor(props: {
  title: string;
  description: string;
  rows: PolicyKeySensitivityRow[];
  fieldLabel: string;
  testIdPrefix: string;
  onChange: (next: PolicyKeySensitivityRow[]) => void;
}): React.ReactElement {
  return (
    <div className="grid gap-3 rounded-lg border border-border p-4">
      <SectionHeading title={props.title} description={props.description} />
      {props.rows.map((row, index) => (
        <div key={row.id} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
          <Input
            label={`Label ${index + 1}`}
            value={row.key}
            error={emptyStringMessage(row.key)}
            onChange={(event) =>
              props.onChange(
                props.rows.map((candidate) =>
                  candidate.id === row.id
                    ? { ...candidate, key: event.currentTarget.value }
                    : candidate,
                ),
              )
            }
          />
          <Input
            label={`Normal ${props.fieldLabel}`}
            inputMode="numeric"
            value={row.normal}
            error={numericError(row.normal)}
            onChange={(event) =>
              props.onChange(
                props.rows.map((candidate) =>
                  candidate.id === row.id
                    ? { ...candidate, normal: event.currentTarget.value }
                    : candidate,
                ),
              )
            }
          />
          <Input
            label={`Sensitive ${props.fieldLabel}`}
            inputMode="numeric"
            value={row.sensitive}
            error={numericError(row.sensitive)}
            onChange={(event) =>
              props.onChange(
                props.rows.map((candidate) =>
                  candidate.id === row.id
                    ? { ...candidate, sensitive: event.currentTarget.value }
                    : candidate,
                ),
              )
            }
          />
          <div className="flex items-end">
            <Button
              variant="ghost"
              onClick={() =>
                props.onChange(props.rows.filter((candidate) => candidate.id !== row.id))
              }
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button
          variant="secondary"
          onClick={() =>
            props.onChange([...props.rows, createBlankKeySensitivityRow(props.testIdPrefix)])
          }
        >
          Add row
        </Button>
      </div>
    </div>
  );
}

export function ArtifactsEditor(props: {
  state: PolicyArtifactsFormState;
  onChange: (next: PolicyArtifactsFormState) => void;
}): React.ReactElement {
  return (
    <Card data-testid="policy-config-artifacts">
      <CardHeader>
        <SectionHeading
          title="Artifacts"
          description="Control whether artifacts are kept and for how long."
        />
      </CardHeader>
      <CardContent className="grid gap-4">
        <PolicyDecisionSelect
          value={props.state.defaultDecision}
          onChange={(next) => props.onChange({ ...props.state, defaultDecision: next })}
        />
        <details className="rounded-lg border border-border p-4" open={true}>
          <summary className="cursor-pointer text-sm font-medium text-fg">Retention rules</summary>
          <div className="mt-4 grid gap-4">
            <Input
              label="Default retention (days)"
              inputMode="numeric"
              value={props.state.retentionDefaultDays}
              error={numericError(props.state.retentionDefaultDays)}
              helperText="Leave blank to rely on more specific rules only."
              onChange={(event) =>
                props.onChange({ ...props.state, retentionDefaultDays: event.currentTarget.value })
              }
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <KeyNumberRowsEditor
                title="Retention by label"
                description="Examples: `log`, `screenshot`, `http_trace`."
                rows={props.state.retentionByLabel}
                fieldLabel="Days"
                testIdPrefix="policy-retention-by-label"
                onChange={(next) => props.onChange({ ...props.state, retentionByLabel: next })}
              />
              <div className="grid gap-3 rounded-lg border border-border p-4">
                <SectionHeading
                  title="Retention by sensitivity"
                  description="Apply a default rule for normal vs sensitive artifacts."
                />
                <Input
                  label="Normal days"
                  inputMode="numeric"
                  value={props.state.retentionBySensitivity.normal}
                  error={numericError(props.state.retentionBySensitivity.normal)}
                  onChange={(event) =>
                    props.onChange({
                      ...props.state,
                      retentionBySensitivity: {
                        ...props.state.retentionBySensitivity,
                        normal: event.currentTarget.value,
                      },
                    })
                  }
                />
                <Input
                  label="Sensitive days"
                  inputMode="numeric"
                  value={props.state.retentionBySensitivity.sensitive}
                  error={numericError(props.state.retentionBySensitivity.sensitive)}
                  onChange={(event) =>
                    props.onChange({
                      ...props.state,
                      retentionBySensitivity: {
                        ...props.state.retentionBySensitivity,
                        sensitive: event.currentTarget.value,
                      },
                    })
                  }
                />
              </div>
            </div>
            <KeySensitivityRowsEditor
              title="Retention by label and sensitivity"
              description="Use when a label needs different retention for normal vs sensitive variants."
              rows={props.state.retentionByLabelSensitivity}
              fieldLabel="days"
              testIdPrefix="policy-retention-by-label-sensitivity"
              onChange={(next) =>
                props.onChange({ ...props.state, retentionByLabelSensitivity: next })
              }
            />
          </div>
        </details>
        <details className="rounded-lg border border-border p-4" open={true}>
          <summary className="cursor-pointer text-sm font-medium text-fg">Quota rules</summary>
          <div className="mt-4 grid gap-4">
            <Input
              label="Default quota (bytes)"
              inputMode="numeric"
              value={props.state.quotaDefaultMaxBytes}
              error={numericError(props.state.quotaDefaultMaxBytes)}
              helperText="Leave blank to rely on more specific rules only."
              onChange={(event) =>
                props.onChange({ ...props.state, quotaDefaultMaxBytes: event.currentTarget.value })
              }
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <KeyNumberRowsEditor
                title="Quota by label"
                description="Examples: `log`, `screenshot`, `http_trace`."
                rows={props.state.quotaByLabel}
                fieldLabel="Bytes"
                testIdPrefix="policy-quota-by-label"
                onChange={(next) => props.onChange({ ...props.state, quotaByLabel: next })}
              />
              <div className="grid gap-3 rounded-lg border border-border p-4">
                <SectionHeading
                  title="Quota by sensitivity"
                  description="Apply a default quota for normal vs sensitive artifacts."
                />
                <Input
                  label="Normal bytes"
                  inputMode="numeric"
                  value={props.state.quotaBySensitivity.normal}
                  error={numericError(props.state.quotaBySensitivity.normal)}
                  onChange={(event) =>
                    props.onChange({
                      ...props.state,
                      quotaBySensitivity: {
                        ...props.state.quotaBySensitivity,
                        normal: event.currentTarget.value,
                      },
                    })
                  }
                />
                <Input
                  label="Sensitive bytes"
                  inputMode="numeric"
                  value={props.state.quotaBySensitivity.sensitive}
                  error={numericError(props.state.quotaBySensitivity.sensitive)}
                  onChange={(event) =>
                    props.onChange({
                      ...props.state,
                      quotaBySensitivity: {
                        ...props.state.quotaBySensitivity,
                        sensitive: event.currentTarget.value,
                      },
                    })
                  }
                />
              </div>
            </div>
            <KeySensitivityRowsEditor
              title="Quota by label and sensitivity"
              description="Use when the same artifact label needs different limits by sensitivity."
              rows={props.state.quotaByLabelSensitivity}
              fieldLabel="bytes"
              testIdPrefix="policy-quota-by-label-sensitivity"
              onChange={(next) => props.onChange({ ...props.state, quotaByLabelSensitivity: next })}
            />
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
