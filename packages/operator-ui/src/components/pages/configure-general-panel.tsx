import { Monitor, Moon, Sun } from "lucide-react";
import { useHostApiOptional } from "../../host/host-api.js";
import { useTheme, type ThemeMode } from "../../hooks/use-theme.js";
import { cn } from "../../lib/cn.js";
import { Alert } from "../ui/alert.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { DesktopUpdatesCard } from "../updates/desktop-updates-card.js";

type ThemeOption = {
  mode: ThemeMode;
  label: string;
  description: string;
  icon: typeof Monitor;
  testId: string;
};

const THEME_OPTIONS: ThemeOption[] = [
  {
    mode: "system",
    label: "System",
    description: "Match your OS preference.",
    icon: Monitor,
    testId: "configure-theme-system",
  },
  {
    mode: "light",
    label: "Light",
    description: "Bright theme for daytime.",
    icon: Sun,
    testId: "configure-theme-light",
  },
  {
    mode: "dark",
    label: "Dark",
    description: "Dim theme for low light.",
    icon: Moon,
    testId: "configure-theme-dark",
  },
];

export function ConfigureGeneralPanel() {
  const theme = useTheme();
  const host = useHostApiOptional();
  const desktopApi = host?.kind === "desktop" ? host.api : null;

  return (
    <div className="grid gap-6" data-testid="configure-general-panel">
      <Card data-testid="configure-theme">
        <CardHeader className="pb-4">
          <div className="text-sm font-medium text-fg">Theme</div>
          <div className="text-sm text-fg-muted">
            Choose system, light, or dark mode. Changes apply immediately.
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Theme">
            {THEME_OPTIONS.map((option) => {
              const active = theme.mode === option.mode;
              const Icon = option.icon;
              return (
                <button
                  key={option.mode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={option.testId}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
                    "hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                    active ? "border-primary bg-bg text-fg" : "border-border bg-bg text-fg",
                  )}
                  onClick={() => {
                    theme.setMode(option.mode);
                  }}
                >
                  <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden={true} />
                  <div className="grid gap-0.5">
                    <div className="text-sm font-medium">{option.label}</div>
                    <div className="text-xs text-fg-muted">{option.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {desktopApi ? (
        <DesktopUpdatesCard
          api={desktopApi}
          title="Update"
          testId="configure-update"
          id="configure-update"
        />
      ) : (
        <Card data-testid="configure-update" id="configure-update">
          <CardHeader className="pb-4">
            <div className="text-sm font-medium text-fg">Update</div>
            <div className="text-sm text-fg-muted">Desktop updates are not available here.</div>
          </CardHeader>
          <CardContent>
            <Alert
              variant="info"
              title="Updates unavailable"
              description="Updates are only available in the desktop app."
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
