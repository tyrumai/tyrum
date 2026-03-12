import * as React from "react";
import { Button } from "../ui/button.js";
import { Select } from "../ui/select.js";

export type CapabilityBucket = { id: string; label: string };

export type AccessFieldState = {
  defaultMode: "allow" | "deny";
  allow: string[];
  deny: string[];
};

function sortIds(values: readonly string[]): string[] {
  return [...values].toSorted((left, right) => left.localeCompare(right));
}

function addSortedIds(values: readonly string[], nextIds: readonly string[]): string[] {
  return sortIds(Array.from(new Set([...values, ...nextIds])));
}

function removeIds(values: readonly string[], idsToRemove: ReadonlySet<string>): string[] {
  return values.filter((value) => !idsToRemove.has(value));
}

function buildAccessBuckets(input: {
  items: readonly CapabilityBucket[];
  state: AccessFieldState;
}): { deny: CapabilityBucket[]; allow: CapabilityBucket[] } {
  const itemsById = new Map(input.items.map((item) => [item.id, item] as const));
  for (const id of [...input.state.allow, ...input.state.deny]) {
    if (!itemsById.has(id)) {
      itemsById.set(id, { id, label: id });
    }
  }

  const allItems = [...itemsById.values()].toSorted((left, right) =>
    left.id.localeCompare(right.id),
  );
  const allowSet = new Set(input.state.allow);
  const denySet = new Set(input.state.deny);

  if (input.state.defaultMode === "allow") {
    return {
      deny: allItems.filter((item) => denySet.has(item.id)),
      allow: allItems.filter((item) => !denySet.has(item.id)),
    };
  }

  return {
    deny: allItems.filter((item) => !allowSet.has(item.id)),
    allow: allItems.filter((item) => allowSet.has(item.id)),
  };
}

export function AccessTransferField(props: {
  title: string;
  defaultLabel: string;
  helperText: string;
  items: readonly CapabilityBucket[];
  state: AccessFieldState;
  disabled?: boolean;
  onDefaultModeChange: (mode: "allow" | "deny") => void;
  onAllowChange: (ids: string[]) => void;
  onDenyChange: (ids: string[]) => void;
}) {
  const [selectedDeny, setSelectedDeny] = React.useState<string[]>([]);
  const [selectedAllow, setSelectedAllow] = React.useState<string[]>([]);
  const buckets = React.useMemo(
    () => buildAccessBuckets({ items: props.items, state: props.state }),
    [props.items, props.state],
  );
  const allowByDefault = props.state.defaultMode === "allow";

  const moveToDeny = React.useCallback(() => {
    const ids = new Set(selectedAllow);
    if (ids.size === 0) return;
    if (allowByDefault) {
      props.onDenyChange(addSortedIds(props.state.deny, [...ids]));
    } else {
      props.onAllowChange(removeIds(props.state.allow, ids));
    }
    setSelectedAllow([]);
  }, [allowByDefault, props, selectedAllow]);

  const moveToAllow = React.useCallback(() => {
    const ids = new Set(selectedDeny);
    if (ids.size === 0) return;
    if (allowByDefault) {
      props.onDenyChange(removeIds(props.state.deny, ids));
    } else {
      props.onAllowChange(addSortedIds(props.state.allow, [...ids]));
    }
    setSelectedDeny([]);
  }, [allowByDefault, props, selectedDeny]);

  const onModeChange = (mode: "allow" | "deny") => {
    props.onDefaultModeChange(mode);
    setSelectedAllow([]);
    setSelectedDeny([]);
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <Select
          label={props.defaultLabel}
          value={props.state.defaultMode}
          disabled={props.disabled}
          onChange={(event) => onModeChange(event.currentTarget.value as "allow" | "deny")}
        >
          <option value="allow">Allow</option>
          <option value="deny">Deny</option>
        </Select>
        <div className="self-end text-sm text-fg-muted">{props.helperText}</div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="grid gap-2">
          <div className="text-sm font-medium text-fg">Deny</div>
          <select
            multiple
            size={10}
            value={selectedDeny}
            disabled={props.disabled}
            className="min-h-48 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
            onChange={(event) => {
              setSelectedDeny(
                Array.from(event.currentTarget.selectedOptions, (option) => option.value),
              );
            }}
          >
            {buckets.deny.map((item) => (
              <option key={`${props.title}-deny-${item.id}`} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col items-center justify-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={props.disabled || selectedAllow.length === 0}
            onClick={moveToDeny}
          >
            Move to deny
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={props.disabled || selectedDeny.length === 0}
            onClick={moveToAllow}
          >
            Move to allow
          </Button>
        </div>
        <div className="grid gap-2">
          <div className="text-sm font-medium text-fg">Allow</div>
          <select
            multiple
            size={10}
            value={selectedAllow}
            disabled={props.disabled}
            className="min-h-48 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg"
            onChange={(event) => {
              setSelectedAllow(
                Array.from(event.currentTarget.selectedOptions, (option) => option.value),
              );
            }}
          >
            {buckets.allow.map((item) => (
              <option key={`${props.title}-allow-${item.id}`} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
