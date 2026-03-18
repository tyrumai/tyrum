import type { OperatorCore } from "@tyrum/operator-core";
import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import type { OperatorUiMode } from "../../app.js";
import { useHostApiOptional } from "../../host/host-api.js";
import { useTheme, type ThemeMode } from "../../hooks/use-theme.js";
import { cn } from "../../lib/cn.js";
import { toast } from "sonner";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import type { WebAuthPersistence } from "../../web-auth.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
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

export function ConfigureGeneralPanel({
  core,
  mode,
  webAuthPersistence,
}: {
  core: OperatorCore;
  mode: OperatorUiMode;
  webAuthPersistence?: WebAuthPersistence;
}) {
  const theme = useTheme();
  const host = useHostApiOptional();
  const desktopApi = host?.kind === "desktop" ? host.api : null;
  const [webAuthBusy, setWebAuthBusy] = useState(false);
  const activeWebAuth = mode === "web" ? webAuthPersistence : undefined;

  const forgetSavedToken = async (): Promise<void> => {
    if (!activeWebAuth?.hasStoredToken) return;
    setWebAuthBusy(true);
    try {
      core.disconnect();
      await activeWebAuth.clearToken();
    } catch (error) {
      toast.error("Forget failed", { description: formatErrorMessage(error) });
    } finally {
      setWebAuthBusy(false);
    }
  };

  return (
    <div className="grid gap-5" data-testid="configure-general-panel">
      <Card data-testid="configure-theme">
        <CardHeader className="pb-2.5">
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

      {activeWebAuth ? (
        <Card data-testid="configure-web-auth">
          <CardHeader className="pb-2.5">
            <div className="text-sm font-medium text-fg">Browser token</div>
            <div className="text-sm text-fg-muted">
              Manage the operator token saved in this browser for automatic reconnects.
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Alert
              variant="info"
              title={activeWebAuth.hasStoredToken ? "Token saved" : "No saved token"}
              description={
                activeWebAuth.hasStoredToken
                  ? "This browser will keep using the saved operator token until you replace or forget it."
                  : "Connect with a tenant admin token to save it in this browser."
              }
            />
            {activeWebAuth.hasStoredToken ? (
              <Button
                data-testid="configure-web-auth-clear"
                variant="secondary"
                isLoading={webAuthBusy}
                onClick={() => {
                  void forgetSavedToken();
                }}
              >
                Forget saved token
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {desktopApi ? (
        <DesktopUpdatesCard
          api={desktopApi}
          title="Update"
          testId="configure-update"
          id="configure-update"
        />
      ) : (
        <Card data-testid="configure-update" id="configure-update">
          <CardHeader className="pb-2.5">
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
