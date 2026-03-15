import type { OperatorCore } from "@tyrum/operator-core";
import type { OperatorUiMode } from "../../app.js";
import { AuditPanel } from "../admin-http/audit-panel.js";
import { AppPage } from "../layout/app-page.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { AuthTokensCard } from "./admin-http-tokens.js";
import { ToolRegistryCard } from "./admin-http-tools.js";
import { AdminHttpModelsPanel } from "./admin-http-models.js";
import { AdminHttpLocationPanel } from "./admin-http-location.js";
import { AdminHttpProvidersPanel } from "./admin-http-providers.js";
import { AdminHttpPolicyAuthPanels } from "./admin-http-policy-auth-panels.js";
import { AdminHttpRoutingConfigPanel } from "./admin-http-routing-config.js";
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

function ConfigurePageContent({ core, mode, webAuthPersistence }: ConfigurePageProps) {
  const [activeTab, setActiveTab] = useReconnectTabState<ConfigurePageTab>(
    "configure.tab",
    "general",
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
                setActiveTab(event.currentTarget.value as ConfigurePageTab);
              }}
            >
              {CONFIGURE_TAB_OPTIONS.map((tab) => (
                <option key={tab.value} value={tab.value}>
                  {tab.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div
          className={isMobileViewport ? "hidden" : "overflow-x-auto pb-1"}
          data-testid="configure-tab-strip"
        >
          <TabsList aria-label="Configure sections" className="min-w-max flex-nowrap">
            {CONFIGURE_TAB_OPTIONS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} data-testid={tab.testId}>
                {tab.label}
              </TabsTrigger>
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
          <AdminHttpRoutingConfigPanel core={core} />
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
