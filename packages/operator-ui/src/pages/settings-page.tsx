import type { OperatorCore } from "@tyrum/operator-core";
import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import type { OperatorUiMode } from "../app.js";
import { AdminModeGate } from "../admin-mode.js";
import { PageHeader } from "../components/layout/page-header.js";
import { Alert } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader } from "../components/ui/card.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import { useTheme, type ThemeMode } from "../hooks/use-theme.js";
import { cn } from "../lib/cn.js";
import { formatErrorMessage } from "../utils/format-error-message.js";
import { useOperatorStore } from "../use-operator-store.js";

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
    testId: "settings-theme-system",
  },
  {
    mode: "light",
    label: "Light",
    description: "Bright theme for daytime.",
    icon: Sun,
    testId: "settings-theme-light",
  },
  {
    mode: "dark",
    label: "Dark",
    description: "Dim theme for low light.",
    icon: Moon,
    testId: "settings-theme-dark",
  },
];

export function SettingsPage({ core, mode }: { core: OperatorCore; mode: OperatorUiMode }) {
  const statusState = useOperatorStore(core.statusStore);
  const theme = useTheme();

  const totalTokens = statusState.usage?.local.totals.total_tokens;
  const formattedTokens =
    typeof totalTokens === "number" ? new Intl.NumberFormat().format(totalTokens) : "-";

  const [adminCommand, setAdminCommand] = useState("/help");
  const [adminCommandBusy, setAdminCommandBusy] = useState(false);
  const [adminCommandError, setAdminCommandError] = useState<string | null>(null);

  const runAdminCommand = async (): Promise<void> => {
    if (adminCommandBusy) return;

    const command = adminCommand.trim();
    if (!command) {
      setAdminCommandError("Command is required");
      return;
    }

    setAdminCommandBusy(true);
    setAdminCommandError(null);

    try {
      if (!core.ws.commandExecute) {
        setAdminCommandError("Admin commands are not supported by this client.");
        return;
      }
      await core.ws.commandExecute(command);
    } catch (error) {
      setAdminCommandError(formatErrorMessage(error));
    } finally {
      setAdminCommandBusy(false);
    }
  };

  return (
    <div className="grid gap-6">
      <PageHeader title="Settings" />

      <Card data-testid="settings-general">
        <CardHeader className="pb-4">
          <div className="text-sm font-medium text-fg">General</div>
          <div className="text-sm text-fg-muted">Basic environment and connection details.</div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-fg-muted">Mode</span>
            <span className="font-medium text-fg">{mode}</span>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3 text-sm">
            <span className="text-fg-muted">Connection URL</span>
            <code className="max-w-full break-all rounded bg-bg-subtle px-2 py-1 text-xs text-fg">
              {core.httpBaseUrl}
            </code>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="settings-usage">
        <CardHeader className="pb-4">
          <div className="text-sm font-medium text-fg">Usage</div>
          <div className="text-sm text-fg-muted">
            Token usage totals for the current gateway instance.
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-fg-muted">Total tokens</span>
            <span className="font-medium text-fg" data-testid="settings-usage-total-tokens">
              {formattedTokens}
            </span>
          </div>
          <div>
            <Button
              data-testid="settings-refresh-usage"
              variant="secondary"
              onClick={() => {
                void core.statusStore.refreshUsage();
              }}
            >
              Refresh usage
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="settings-theme">
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
                    active ? "border-primary bg-primary-dim/20 text-fg" : "border-border text-fg",
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

      <div className="grid gap-3">
        <h2 className="text-lg font-semibold text-fg">Admin</h2>
        <AdminModeGate>
          <Card className="border-error/30 bg-error/5" data-testid="settings-admin">
            <CardHeader className="pb-4">
              <div className="text-sm font-medium text-fg">Admin actions</div>
              <div className="text-sm text-fg-muted">
                Admin Mode enables dangerous operator actions. It is time-limited (10 minutes) and
                can be exited at any time.
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="admin-command">Admin command</Label>
                <Input
                  id="admin-command"
                  data-testid="settings-admin-command-input"
                  value={adminCommand}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  onChange={(event) => {
                    setAdminCommand(event.target.value);
                  }}
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  data-testid="settings-admin-command-execute"
                  variant="secondary"
                  isLoading={adminCommandBusy}
                  onClick={() => {
                    void runAdminCommand();
                  }}
                >
                  {adminCommandBusy ? "Running..." : "Run command"}
                </Button>
              </div>

              {adminCommandError ? (
                <Alert
                  variant="error"
                  title="Admin command failed"
                  description={adminCommandError}
                />
              ) : null}
            </CardContent>
          </Card>
        </AdminModeGate>
      </div>
    </div>
  );
}
