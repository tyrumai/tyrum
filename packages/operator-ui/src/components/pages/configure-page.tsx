import type { OperatorCore } from "@tyrum/operator-app";
import * as React from "react";
import type { OperatorUiMode } from "../../app.js";
import { AuditPanel } from "../admin-http/audit-panel.js";
import { AppPage } from "../layout/app-page.js";
import { Separator } from "../ui/separator.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { AuthTokensCard } from "./admin-http-tokens.js";
import { ToolRegistryCard } from "./admin-http-tools.js";
import { AdminHttpModelsPanel } from "./admin-http-models.js";
import { AdminHttpLocationPanel } from "./admin-http-location.js";
import { AdminHttpProvidersPanel } from "./admin-http-providers.js";
import { AdminHttpPolicyAuthPanels } from "./admin-http-policy-auth-panels.js";
import { AdminHttpChannelsPanel } from "./admin-http-channels.js";
import { AdminHttpSecretsPanel } from "./admin-http-secrets.js";
import { AdminWsCommandPanel } from "./admin-ws-command-panel.js";
import { AdminMutationGate } from "./admin-http-shared.js";
import { ConfigureGeneralPanel } from "./configure-general-panel.js";
import { useMediaQuery } from "../../hooks/use-media-query.js";
import { ThemeProvider, useThemeOptional } from "../../hooks/use-theme.js";
import { useReconnectScrollArea, useReconnectTabState } from "../../reconnect-ui-state.js";
import { Select } from "../ui/select.js";
import type { WebAuthPersistence } from "../../web-auth.js";

export interface ConfigurePageProps {
  core: OperatorCore;
  mode: OperatorUiMode;
  webAuthPersistence?: WebAuthPersistence;
  initialTab?: string;
  onTabChange?: (tab: string) => void;
}

type ConfigurePageTab =
  | "general"
  | "policy"
  | "providers"
  | "models"
  | "audit"
  | "routing-config"
  | "location"
  | "secrets"
  | "tools"
  | "device-tokens"
  | "commands";

const CONFIGURE_TAB_OPTIONS: ReadonlyArray<{
  value: ConfigurePageTab;
  label: string;
  testId: string;
}> = [
  { value: "general", label: "General", testId: "configure-tab-general" },
  { value: "policy", label: "Policy", testId: "admin-http-tab-policy" },
  { value: "providers", label: "Providers", testId: "admin-http-tab-providers" },
  { value: "models", label: "Models", testId: "admin-http-tab-models" },
  { value: "audit", label: "Audit", testId: "admin-http-tab-audit" },
  { value: "routing-config", label: "Channels", testId: "admin-http-tab-routing-config" },
  { value: "location", label: "Location", testId: "admin-http-tab-location" },
  { value: "secrets", label: "Secrets", testId: "admin-http-tab-secrets" },
  { value: "tools", label: "Tools", testId: "admin-http-tab-tools" },
  { value: "device-tokens", label: "Tokens", testId: "admin-http-tab-gateway" },
  { value: "commands", label: "Commands", testId: "admin-ws-tab-commands" },
] as const;

const CONFIGURE_TAB_CLUSTERS: ReadonlyArray<{
  label: string;
  tabs: readonly ConfigurePageTab[];
}> = [
  { label: "Core", tabs: ["general", "location"] },
  { label: "AI", tabs: ["providers", "models", "routing-config", "tools"] },
  { label: "Admin", tabs: ["policy", "secrets", "audit", "device-tokens", "commands"] },
];

function ConfigurePageContent({
  core,
  mode,
  webAuthPersistence,
  initialTab,
  onTabChange,
}: ConfigurePageProps) {
  const [activeTab, setActiveTab] = useReconnectTabState<ConfigurePageTab>(
    "configure.tab",
    (initialTab as ConfigurePageTab) ?? "general",
  );
  const scrollAreaRef = useReconnectScrollArea(`configure:${activeTab}:page`);
  const isMobileViewport = useMediaQuery("(max-width: 767px)");

  return (
    <AppPage
      contentClassName="max-w-6xl gap-4"
      data-testid="configure-page"
      scrollAreaRef={scrollAreaRef}
    >
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value as ConfigurePageTab);
          onTabChange?.(value);
        }}
        className="grid gap-3"
      >
        {isMobileViewport ? (
          <div className="md:hidden">
            <Select
              label="Section"
              value={activeTab}
              data-testid="configure-section-select"
              onChange={(event) => {
                const value = event.currentTarget.value as ConfigurePageTab;
                setActiveTab(value);
                onTabChange?.(value);
              }}
            >
              {CONFIGURE_TAB_CLUSTERS.map((cluster) => (
                <optgroup key={cluster.label} label={cluster.label}>
                  {cluster.tabs.map((tabValue) => {
                    const tab = CONFIGURE_TAB_OPTIONS.find((t) => t.value === tabValue);
                    if (!tab) return null;
                    return (
                      <option key={tab.value} value={tab.value}>
                        {tab.label}
                      </option>
                    );
                  })}
                </optgroup>
              ))}
            </Select>
          </div>
        ) : null}
        <div
          className={isMobileViewport ? "hidden" : "overflow-x-auto pb-1"}
          data-testid="configure-tab-strip"
        >
          <TabsList aria-label="Settings sections" className="min-w-max flex-nowrap">
            {CONFIGURE_TAB_CLUSTERS.map((cluster, clusterIndex) => (
              <React.Fragment key={cluster.label}>
                {clusterIndex > 0 ? (
                  <Separator orientation="vertical" className="mx-1.5 h-4" decorative />
                ) : null}
                <span className="text-xs text-fg-muted font-medium px-1.5 self-center select-none">
                  {cluster.label}
                </span>
                {cluster.tabs.map((tabValue) => {
                  const tab = CONFIGURE_TAB_OPTIONS.find((t) => t.value === tabValue);
                  if (!tab) return null;
                  return (
                    <TabsTrigger key={tab.value} value={tab.value} data-testid={tab.testId}>
                      {tab.label}
                    </TabsTrigger>
                  );
                })}
              </React.Fragment>
            ))}
          </TabsList>
        </div>

        <TabsContent value="general">
          <ConfigureGeneralPanel core={core} mode={mode} webAuthPersistence={webAuthPersistence} />
        </TabsContent>

        <TabsContent value="policy">
          <AdminHttpPolicyAuthPanels core={core} />
        </TabsContent>

        <TabsContent value="providers">
          <AdminHttpProvidersPanel core={core} />
        </TabsContent>

        <TabsContent value="models">
          <AdminHttpModelsPanel core={core} />
        </TabsContent>

        <TabsContent value="audit">
          <AdminMutationGate core={core}>
            <AuditPanel core={core} />
          </AdminMutationGate>
        </TabsContent>

        <TabsContent value="routing-config">
          <AdminHttpChannelsPanel core={core} />
        </TabsContent>

        <TabsContent value="location">
          <AdminHttpLocationPanel core={core} />
        </TabsContent>

        <TabsContent value="secrets">
          <AdminHttpSecretsPanel core={core} />
        </TabsContent>

        <TabsContent value="tools">
          <ToolRegistryCard core={core} />
        </TabsContent>

        <TabsContent value="device-tokens">
          <AdminMutationGate core={core}>
            <AuthTokensCard core={core} />
          </AdminMutationGate>
        </TabsContent>

        <TabsContent value="commands">
          <AdminMutationGate core={core}>
            <AdminWsCommandPanel core={core} />
          </AdminMutationGate>
        </TabsContent>
      </Tabs>
    </AppPage>
  );
}

export function ConfigurePage(props: ConfigurePageProps) {
  const existingTheme = useThemeOptional();
  const page = <ConfigurePageContent {...props} />;
  return existingTheme ? page : <ThemeProvider>{page}</ThemeProvider>;
}
