import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../../lib/cn.js";
import { Alert } from "../../ui/alert.js";
import { Badge } from "../../ui/badge.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { Switch } from "../../ui/switch.js";
import { Textarea } from "../../ui/textarea.js";
import { TestActionsPanel } from "./node-config-page.test-actions.js";
import type {
  CapabilityAction,
  CapabilityAllowlist,
  CapabilityToggle,
  NormalizedCapability,
  SaveStatus,
} from "./node-config-page.types.js";

// ─── Save status indicator ──────────────────────────────────────────────────

function SaveStatusIndicator({ status, error }: { status: SaveStatus; error: string | null }) {
  switch (status) {
    case "saving":
      return <span className="text-xs text-fg-muted">Saving…</span>;
    case "saved":
      return <span className="text-xs text-success">Saved</span>;
    case "error":
      return (
        <span className="text-xs text-error" title={error ?? "Save failed"}>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-error" aria-hidden="true" />
          Error
        </span>
      );
    case "idle":
    default:
      return null;
  }
}

// ─── Availability status dot ────────────────────────────────────────────────

function AvailabilityDot({ status }: { status: CapabilityAction["availabilityStatus"] }) {
  const colorClass =
    status === "available" ? "bg-success" : status === "unavailable" ? "bg-error" : "bg-neutral";

  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", colorClass)}
      aria-label={status}
    />
  );
}

// ─── Sub-action row ─────────────────────────────────────────────────────────

function ActionRow({ action }: { action: CapabilityAction }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
      <div className="min-w-0 grid gap-0.5">
        <div className="flex items-center gap-2">
          <AvailabilityDot status={action.availabilityStatus} />
          <span className="text-sm font-medium text-fg">{action.label}</span>
        </div>
        <div className="text-xs text-fg-muted">{action.description}</div>
        {action.availabilityStatus === "unavailable" && action.unavailableReason ? (
          <div className="text-xs text-error">{action.unavailableReason}</div>
        ) : null}
      </div>
      <Switch
        className="shrink-0"
        aria-label={`Toggle ${action.label}`}
        checked={action.enabled}
        onCheckedChange={action.onToggle}
      />
    </div>
  );
}

// ─── Allowlist section ──────────────────────────────────────────────────────

function AllowlistSection({ allowlist }: { allowlist: CapabilityAllowlist }) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 text-sm font-semibold text-fg">{allowlist.label}</div>
        <Badge variant={allowlist.active ? "danger" : "success"} className="shrink-0">
          {allowlist.active ? "active (default deny)" : "inactive (default allow)"}
        </Badge>
      </div>

      <Textarea
        label={`${allowlist.label} (one per line)`}
        value={allowlist.value}
        disabled={!allowlist.active}
        onChange={(event) => allowlist.onChange(event.target.value)}
        placeholder={allowlist.placeholder}
      />

      {allowlist.notes.length > 0 ? (
        <div className="grid gap-1 text-sm text-fg-muted">
          {allowlist.notes.map((note) => (
            <div key={note}>{note}</div>
          ))}
        </div>
      ) : null}

      {allowlist.saveStatus === "saving" ? (
        <span className="text-xs text-fg-muted">Saving…</span>
      ) : allowlist.saveStatus === "saved" ? (
        <span className="text-xs text-success">Saved</span>
      ) : allowlist.saveStatus === "error" && allowlist.saveError ? (
        <span className="text-xs text-error">{allowlist.saveError}</span>
      ) : null}

      {allowlist.showWarning && allowlist.warningTitle && allowlist.warningDescription ? (
        <Alert
          variant="warning"
          title={allowlist.warningTitle}
          description={allowlist.warningDescription}
        />
      ) : null}
    </div>
  );
}

// ─── Toggle row ─────────────────────────────────────────────────────────────

function ToggleRow({ toggle }: { toggle: CapabilityToggle }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-bg px-3 py-2">
      <div className="min-w-0 grid gap-0.5">
        <div className="text-sm font-medium text-fg">{toggle.label}</div>
        <div className="text-xs text-fg-muted">{toggle.description}</div>
      </div>
      <Switch
        className="shrink-0"
        aria-label={toggle.label}
        checked={toggle.checked}
        onCheckedChange={toggle.onChange}
      />
    </div>
  );
}

// ─── CapabilitySection ──────────────────────────────────────────────────────

export interface CapabilitySectionProps {
  capability: NormalizedCapability;
  /** Control expanded state externally. Falls back to internal state. */
  defaultExpanded?: boolean;
}

export function CapabilitySection({ capability, defaultExpanded = false }: CapabilitySectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const Icon = capability.icon;

  const hasExpandableContent =
    capability.actions.length > 0 ||
    capability.allowlists.length > 0 ||
    capability.toggles.length > 0 ||
    capability.testActions.length > 0 ||
    capability.extraContent !== undefined;

  return (
    <Card
      className={cn(
        "border-l-[3px] transition-colors",
        capability.enabled ? "border-l-success" : "border-l-neutral",
      )}
    >
      <CardContent className="grid gap-0 pt-4">
        {/* ── Header row ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border">
            <Icon className="h-4 w-4 text-fg-muted" aria-hidden="true" />
          </div>

          {/* Label + status */}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-fg">{capability.label}</div>
            <div className="text-xs text-fg-muted">{capability.statusSummary}</div>
          </div>

          {/* Save status + Switch */}
          <div className="flex shrink-0 items-center gap-3">
            <SaveStatusIndicator status={capability.saveStatus} error={capability.saveError} />
            <Switch
              aria-label={`Toggle ${capability.label}`}
              checked={capability.enabled}
              onCheckedChange={capability.onToggle}
            />
          </div>
        </div>

        {/* ── Expand/collapse button ─────────────────────────────────────── */}
        {hasExpandableContent ? (
          <div className="flex justify-center pt-1">
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={expanded}
              aria-label={expanded ? "Collapse" : "Expand"}
              onClick={() => setExpanded((prev) => !prev)}
            >
              <ChevronDown
                aria-hidden={true}
                className={cn("h-4 w-4 transition-transform", expanded ? "rotate-0" : "-rotate-90")}
              />
            </Button>
          </div>
        ) : null}

        {/* ── Expanded content ───────────────────────────────────────────── */}
        {expanded ? (
          <div className="grid gap-4 pt-3">
            {/* Description */}
            <div className="text-sm text-fg-muted">{capability.description}</div>

            {/* Action controls */}
            {capability.actions.length > 0 ? (
              <div className="grid gap-3 rounded-lg border border-border/70 p-4">
                <div className="text-sm font-semibold text-fg">Action controls</div>
                {capability.actions.map((action) => (
                  <ActionRow key={action.name} action={action} />
                ))}
              </div>
            ) : null}

            {/* Allowlists */}
            {capability.allowlists.map((allowlist) => (
              <AllowlistSection key={allowlist.key} allowlist={allowlist} />
            ))}

            {/* Toggles */}
            {capability.toggles.length > 0 ? (
              <div className="grid gap-2">
                {capability.toggles.map((toggle) => (
                  <ToggleRow key={toggle.key} toggle={toggle} />
                ))}
              </div>
            ) : null}

            {/* Test actions */}
            {capability.testActions.length > 0 ? (
              <TestActionsPanel testActions={capability.testActions} />
            ) : null}

            {/* Extra content */}
            {capability.extraContent}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
