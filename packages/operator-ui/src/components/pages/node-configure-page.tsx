import { useState } from "react";
import type { DesktopApi } from "../../desktop-api.js";
import { useHostApi } from "../../host/host-api.js";
import { AppPage } from "../layout/app-page.js";
import { Alert } from "../ui/alert.js";
import { Card, CardContent } from "../ui/card.js";
import { Switch } from "../ui/switch.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import {
  AllowlistCard,
  CapabilityCard,
  MacPermissionsCard,
  NodeConnectionCard,
  SaveActions,
  SecurityProfileCard,
} from "./node-configure-page.cards.js";
import { useDesktopNodeConfigureModel } from "./node-configure-page.model.js";
import {
  BROWSER_DOMAIN_NOTES,
  SHELL_COMMAND_NOTES,
  SHELL_DIRECTORY_NOTES,
} from "./node-configure-page.shared.js";

type ConfigureTab = "connection" | "profile" | "desktop" | "browser" | "shell" | "web";

export function NodeConfigurePage({ onReloadPage }: { onReloadPage?: () => void }) {
  const host = useHostApi();
  if (host.kind !== "desktop") {
    return (
      <AppPage title="Node Configuration" contentClassName="max-w-5xl gap-4">
        <Alert
          variant="warning"
          title="Not available"
          description="Node configuration is only available in the desktop app."
        />
      </AppPage>
    );
  }

  const api = host.api;
  if (!api) {
    return (
      <AppPage title="Node Configuration" contentClassName="max-w-5xl gap-4">
        <Alert variant="error" title="Desktop API not available." />
      </AppPage>
    );
  }

  return <DesktopNodeConfigurePage api={api} onReloadPage={onReloadPage} />;
}

function DesktopNodeConfigurePage({
  api,
  onReloadPage,
}: {
  api: DesktopApi;
  onReloadPage?: () => void;
}) {
  const [tab, setTab] = useState<ConfigureTab>("connection");
  const model = useDesktopNodeConfigureModel(api, onReloadPage);
  const saveBusy = model.generalSaving || model.profileSaving || model.securitySaving;

  if (model.loading) {
    return (
      <AppPage title="Node Configuration" contentClassName="max-w-5xl gap-4">
        <Card>
          <CardContent className="grid gap-2 pt-6 text-sm text-fg-muted">
            <div>Loading node settings…</div>
          </CardContent>
        </Card>
      </AppPage>
    );
  }

  if (model.loadError) {
    return (
      <AppPage title="Node Configuration" contentClassName="max-w-5xl gap-4">
        <Alert variant="error" title="Failed to load node settings" description={model.loadError} />
      </AppPage>
    );
  }

  return (
    <AppPage title="Node Configuration" contentClassName="max-w-6xl gap-4">
      <div className="text-sm text-fg-muted">
        Configure the local node runtime used by Tyrum Desktop.
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ConfigureTab)}
        className="grid gap-4"
      >
        <TabsList className="flex-wrap">
          <TabsTrigger value="connection">Connection</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="desktop">Desktop</TabsTrigger>
          <TabsTrigger value="browser">Browser</TabsTrigger>
          <TabsTrigger value="shell">Shell</TabsTrigger>
          <TabsTrigger value="web">Web</TabsTrigger>
        </TabsList>

        <TabsContent value="connection" className="grid gap-5">
          <NodeConnectionCard
            connection={model.connection}
            currentOperatorConnection={model.currentOperatorConnection}
            currentTokenLoading={model.currentTokenLoading}
            currentTokenError={model.currentTokenError}
            connectionDirty={model.generalDirty}
            backgroundState={model.backgroundState}
            backgroundBusy={model.backgroundBusy}
            backgroundError={model.backgroundError}
            onModeChange={model.setMode}
            onPortChange={model.setPort}
            onRemoteUrlChange={model.setRemoteUrl}
            onRemoteTokenChange={model.setRemoteToken}
            onRemoteTlsFingerprintChange={model.setRemoteTlsCertFingerprint256}
            onRemoteTlsAllowSelfSignedChange={model.setRemoteTlsAllowSelfSigned}
            onToggleBackgroundMode={model.toggleBackgroundMode}
          />
          <SaveActions
            buttonLabel="Save Connection Settings"
            testId="node-configure-save-connection"
            isLoading={model.generalSaving}
            saved={model.generalSaved}
            disabled={saveBusy || !model.generalDirty}
            errorMessage={model.generalError}
            onSave={model.saveGeneral}
          />
        </TabsContent>

        <TabsContent value="profile" className="grid gap-5">
          <SecurityProfileCard
            profile={model.displayProfile}
            onProfileChange={model.applyProfile}
          />
          <SaveActions
            buttonLabel="Save Profile Settings"
            testId="node-configure-save-profile"
            isLoading={model.profileSaving}
            saved={model.profileSaved}
            disabled={saveBusy || !model.securityDirty}
            errorMessage={model.profileError}
            onSave={model.saveProfile}
          />
        </TabsContent>

        <TabsContent value="desktop" className="grid gap-5">
          <CapabilityCard
            title="Desktop"
            capabilityTestId="node-capability-desktop"
            description="Enable local desktop automation capabilities such as screenshots and input."
            enabled={model.security.capabilities.desktop}
            onEnabledChange={(next) => model.setCapability("desktop", next)}
          />
          <MacPermissionsCard
            apiAvailable={Boolean(api.checkMacPermissions)}
            summary={model.macPermissionSummary}
            checking={model.macPermissionChecking}
            requestingPermission={model.requestingMacPermission}
            errorMessage={model.macPermissionError}
            onCheck={model.checkMacPermissions}
            onRequest={model.requestMacPermission}
          />
          <SaveActions
            buttonLabel="Save Node Settings"
            testId="node-configure-save-security"
            isLoading={model.securitySaving}
            saved={model.securitySaved}
            disabled={saveBusy || !model.securityDirty}
            errorMessage={model.securityError}
            onSave={model.saveSecurity}
          />
        </TabsContent>

        <TabsContent value="browser" className="grid gap-5">
          <CapabilityCard
            title="Browser"
            capabilityTestId="node-capability-browser"
            description="Enable browser automation. This uses the existing Playwright-backed local browser provider."
            enabled={model.security.capabilities.playwright}
            onEnabledChange={(next) => model.setCapability("playwright", next)}
          />
          <AllowlistCard
            title="Browser domain allowlist"
            active={model.browserAllowlistActive}
            value={model.browserDomainsDraft}
            onChange={model.updateBrowserDomains}
            placeholder={"example.com\ndocs.example.com\n*"}
            notes={BROWSER_DOMAIN_NOTES}
            warningTitle="Browser allowlist is active and empty"
            warningDescription="Browser navigation is default deny until you add at least one domain (or `*`)."
            showWarning={
              model.browserAllowlistActive && model.security.web.allowedDomains.length === 0
            }
          />
          <Card>
            <CardContent className="grid gap-4 pt-6">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border py-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-fg">Headless mode</div>
                  <div className="text-sm text-fg-muted">
                    Launch the local browser without opening a visible window.
                  </div>
                </div>
                <Switch
                  className="shrink-0"
                  checked={model.security.web.headless}
                  onCheckedChange={model.setBrowserHeadless}
                />
              </div>
            </CardContent>
          </Card>
          <SaveActions
            buttonLabel="Save Node Settings"
            testId="node-configure-save-security"
            isLoading={model.securitySaving}
            saved={model.securitySaved}
            disabled={saveBusy || !model.securityDirty}
            errorMessage={model.securityError}
            onSave={model.saveSecurity}
          />
        </TabsContent>

        <TabsContent value="shell" className="grid gap-5">
          <CapabilityCard
            title="Shell"
            capabilityTestId="node-capability-shell"
            description="Enable local shell command execution through the desktop node runtime."
            enabled={model.security.capabilities.cli}
            onEnabledChange={(next) => model.setCapability("cli", next)}
          />
          <AllowlistCard
            title="Allowed commands"
            active={model.shellAllowlistActive}
            value={model.cliCommandsDraft}
            onChange={(value) => model.updateCliField("allowedCommands", value)}
            placeholder={"git status\nnode --version\n*"}
            notes={SHELL_COMMAND_NOTES}
            warningTitle="Shell allowlist is active and empty"
            warningDescription="Shell execution is default deny until you add at least one rule (or `*`)."
            showWarning={
              model.shellAllowlistActive && model.security.cli.allowedCommands.length === 0
            }
          />
          <AllowlistCard
            title="Allowed working directories"
            active={model.shellAllowlistActive}
            value={model.cliWorkingDirsDraft}
            onChange={(value) => model.updateCliField("allowedWorkingDirs", value)}
            placeholder={"/home/user/projects\n*"}
            notes={SHELL_DIRECTORY_NOTES}
          />
          <SaveActions
            buttonLabel="Save Node Settings"
            testId="node-configure-save-security"
            isLoading={model.securitySaving}
            saved={model.securitySaved}
            disabled={saveBusy || !model.securityDirty}
            errorMessage={model.securityError}
            onSave={model.saveSecurity}
          />
        </TabsContent>

        <TabsContent value="web" className="grid gap-5">
          <CapabilityCard
            title="Web"
            capabilityTestId="node-capability-web"
            description="Enable outbound HTTP access from the local node runtime."
            enabled={model.security.capabilities.http}
            onEnabledChange={(next) => model.setCapability("http", next)}
          />
          <Alert
            variant="info"
            title="No additional Web settings yet"
            description="This tab controls whether the local node advertises Web access. Domain and request policy settings are not part of this pass."
          />
          <SaveActions
            buttonLabel="Save Node Settings"
            testId="node-configure-save-security"
            isLoading={model.securitySaving}
            saved={model.securitySaved}
            disabled={saveBusy || !model.securityDirty}
            errorMessage={model.securityError}
            onSave={model.saveSecurity}
          />
        </TabsContent>
      </Tabs>
    </AppPage>
  );
}
