import type * as React from "react";
import { CheckCircle2, Monitor, Moon, Shield, ShieldCheck, Sun } from "lucide-react";
import { translateStringAttribute, useI18n, useTranslateNode } from "../../i18n-helpers.js";
import type { AdminAccessMode } from "../../hooks/use-admin-access-mode.js";
import type { ColorPalette, ThemeMode } from "../../hooks/use-theme.js";
import { cn } from "../../lib/cn.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { OnboardingStepFrame } from "./first-run-onboarding.parts.js";
import { PALETTE_OPTIONS } from "./palette-options.js";

const ADMIN_ACCESS_OPTIONS: ReadonlyArray<{
  description: string;
  icon: typeof Shield;
  label: string;
  mode: AdminAccessMode;
}> = [
  {
    mode: "on-demand",
    label: "Ask before changes",
    description: "Tyrum stays read-only until you approve a settings change.",
    icon: Shield,
  },
  {
    mode: "always-on",
    label: "Keep access ready",
    description:
      "Keep configuration access ready so Tyrum can change settings without an extra approval step.",
    icon: ShieldCheck,
  },
] as const;

const THEME_OPTIONS: ReadonlyArray<{
  description: string;
  icon: typeof Monitor;
  label: string;
  mode: ThemeMode;
}> = [
  {
    mode: "system",
    label: "System",
    description: "Match your OS preference.",
    icon: Monitor,
  },
  {
    mode: "light",
    label: "Light",
    description: "Bright theme for daytime.",
    icon: Sun,
  },
  {
    mode: "dark",
    label: "Dark",
    description: "Dim theme for low light.",
    icon: Moon,
  },
] as const;

export function OnboardingPaletteStep({
  onContinue,
  onSelectMode,
  onSelectPalette,
  selectedMode,
  selectedPalette,
}: {
  onContinue: () => void;
  onSelectMode: (mode: ThemeMode) => void;
  onSelectPalette: (palette: ColorPalette) => void;
  selectedMode: ThemeMode;
  selectedPalette: ColorPalette;
}): React.ReactElement {
  const intl = useI18n();
  const translateNode = useTranslateNode();
  const selectedOption = PALETTE_OPTIONS.find((option) => option.id === selectedPalette);

  if (!selectedOption) {
    throw new Error(`Unknown onboarding palette: ${selectedPalette}`);
  }

  return (
    <OnboardingStepFrame stepId="palette">
      <div className="grid gap-5" data-testid="first-run-onboarding-step-palette">
        <div className="grid gap-2">
          <div className="text-sm font-medium text-fg">{translateNode("Theme")}</div>
          <div className="text-sm text-fg-muted">
            {translateNode("Choose system, light, or dark mode. Changes apply immediately.")}
          </div>
          <div
            className="grid gap-3 sm:grid-cols-3"
            role="radiogroup"
            aria-label={translateStringAttribute(intl, "Theme")}
          >
            {THEME_OPTIONS.map((option) => {
              const active = selectedMode === option.mode;
              const Icon = option.icon;

              return (
                <button
                  key={option.mode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`first-run-onboarding-theme-${option.mode}`}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
                    "hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                    active ? "border-primary bg-bg text-fg" : "border-border bg-bg text-fg",
                  )}
                  onClick={() => {
                    onSelectMode(option.mode);
                  }}
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden={true} />
                  <div className="grid gap-0.5">
                    <div className="text-sm font-medium">{translateNode(option.label)}</div>
                    <div className="text-xs text-fg-muted">{translateNode(option.description)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-2">
          <div className="text-sm font-medium text-fg">{translateNode("Color palette")}</div>
          <div className="text-sm text-fg-muted">
            {translateNode("Choose a color identity. Works with any theme mode.")}
          </div>
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-5"
            role="radiogroup"
            aria-label={translateStringAttribute(intl, "Color palette")}
          >
            {PALETTE_OPTIONS.map((option) => {
              const active = selectedPalette === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`first-run-onboarding-palette-${option.id}`}
                  className={cn(
                    "flex w-full flex-col items-center gap-1.5 rounded-lg border px-2.5 py-2.5 text-center transition-colors",
                    "hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                    active ? "border-primary bg-bg" : "border-border bg-bg",
                  )}
                  onClick={() => {
                    onSelectPalette(option.id);
                  }}
                >
                  <div className="flex gap-1">
                    {option.swatches.map((color, index) => (
                      <span
                        key={index}
                        className="h-4 w-4 rounded-full border border-border"
                        style={{ backgroundColor: color }}
                        aria-hidden={true}
                      />
                    ))}
                  </div>
                  <div className="grid gap-0.5 leading-tight">
                    <div className="text-sm font-medium">{translateNode(option.label)}</div>
                    <div className="text-[11px] text-fg-muted">
                      {translateNode(option.description)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="rounded-lg border border-border/70 bg-bg-subtle/30 px-3 py-2 text-xs text-fg-muted">
            {translateNode(
              "You can change the palette later from Configure if you want a different look.",
            )}
          </div>
          <div className="grid gap-3 rounded-xl border border-border/70 bg-bg-subtle/20 px-4 py-3">
            <div className="grid gap-1">
              <div className="text-sm font-medium text-fg">{translateNode("Palette preview")}</div>
              <div className="text-xs text-fg-muted">
                {translateNode(selectedOption.description)}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedOption.swatches.map((color, index) => (
                <span
                  key={index}
                  className="h-6 w-6 rounded-full border border-border"
                  style={{ backgroundColor: color }}
                  aria-hidden={true}
                />
              ))}
              <span className="rounded-full border border-primary/30 bg-primary-dim/20 px-2.5 py-1 text-xs font-medium text-fg">
                {translateNode("Accent")}
              </span>
              <span className="rounded-full border border-border/70 bg-bg px-2.5 py-1 text-xs text-fg-muted">
                {translateNode("Surface")}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            data-testid="first-run-onboarding-palette-continue"
            onClick={onContinue}
          >
            Continue
          </Button>
        </div>
      </div>
    </OnboardingStepFrame>
  );
}

export function OnboardingAdminStep({
  busy,
  canMutate,
  continueWithAdminAccess,
  onModeChange,
  selectedMode,
}: {
  busy: boolean;
  canMutate: boolean;
  continueWithAdminAccess: () => void;
  onModeChange: (mode: AdminAccessMode) => void;
  selectedMode: AdminAccessMode;
}): React.ReactElement {
  const intl = useI18n();
  const translateNode = useTranslateNode();
  return (
    <OnboardingStepFrame stepId="admin">
      <div className="grid gap-4" data-testid="first-run-onboarding-step-admin">
        <div className="grid gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-4">
          <div className="text-sm font-medium text-fg">
            {translateNode("Choose how admin access should work.")}
          </div>
          <div className="text-sm text-fg-muted">
            {translateNode(
              "On-demand access keeps operator actions read-only until you elevate. Always-on access automatically authorizes and renews admin access after connect.",
            )}
          </div>
        </div>
        {canMutate ? (
          <Alert
            variant="info"
            title="Admin access is already active"
            description="Save the preference you want Tyrum to use after this setup conversation."
          />
        ) : null}
        <div
          className="grid gap-3 sm:grid-cols-2"
          role="radiogroup"
          aria-label={translateStringAttribute(intl, "Admin access")}
        >
          {ADMIN_ACCESS_OPTIONS.map((option) => {
            const active = selectedMode === option.mode;
            const Icon = option.icon;

            return (
              <button
                key={option.mode}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`first-run-onboarding-admin-mode-${option.mode}`}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
                  "hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                  active ? "border-primary bg-bg text-fg" : "border-border bg-bg text-fg",
                )}
                onClick={() => {
                  onModeChange(option.mode);
                }}
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden={true} />
                <div className="grid gap-0.5">
                  <div className="text-sm font-medium">{translateNode(option.label)}</div>
                  <div className="text-xs text-fg-muted">{translateNode(option.description)}</div>
                </div>
              </button>
            );
          })}
        </div>
        <Button
          type="button"
          variant="warning"
          size="lg"
          className="w-full justify-center sm:w-auto"
          data-testid="first-run-onboarding-admin-continue"
          isLoading={busy}
          onClick={continueWithAdminAccess}
        >
          <ShieldCheck className="h-4 w-4" />
          {canMutate
            ? translateNode("Save choice and continue")
            : translateNode("Save choice and authorize access")}
        </Button>
      </div>
    </OnboardingStepFrame>
  );
}

export function OnboardingCompletionStep({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (routeId: "dashboard") => void;
}): React.ReactElement {
  const translateNode = useTranslateNode();
  return (
    <div
      className="grid place-items-center gap-4 py-8 text-center"
      data-testid="first-run-onboarding-step-done"
    >
      <CheckCircle2 className="h-12 w-12 text-success" />
      <h2 className="text-lg font-semibold text-fg">{translateNode("Setup complete")}</h2>
      <p className="max-w-md text-sm text-fg-muted">
        {translateNode(
          "Your workspace is configured and ready. You can adjust settings at any time from the sidebar.",
        )}
      </p>
      <Button
        onClick={() => {
          onClose();
          onNavigate("dashboard");
        }}
      >
        {translateNode("Go to Dashboard")}
      </Button>
    </div>
  );
}
