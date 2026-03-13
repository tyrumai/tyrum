import type { OperatorCore } from "@tyrum/operator-core";
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
import { ThemeProvider, useThemeOptional } from "../../hooks/use-theme.js";
import { useReconnectScrollArea, useReconnectTabState } from "../../reconnect-ui-state.js";

export interface ConfigurePageProps {
  core: OperatorCore;
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

function ConfigurePageContent({ core }: ConfigurePageProps) {
  const [activeTab, setActiveTab] = useReconnectTabState<ConfigurePageTab>(
    "configure.tab",
    "general",
  );
  const scrollAreaRef = useReconnectScrollArea(`configure:${activeTab}:page`);

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
        <TabsList aria-label="Configure sections" className="flex-wrap">
          <TabsTrigger value="general" data-testid="configure-tab-general">
            General
          </TabsTrigger>
          <TabsTrigger value="policy" data-testid="admin-http-tab-policy">
            Policy
          </TabsTrigger>
          <TabsTrigger value="providers" data-testid="admin-http-tab-providers">
            Providers
          </TabsTrigger>
          <TabsTrigger value="models" data-testid="admin-http-tab-models">
            Models
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="admin-http-tab-audit">
            Audit
          </TabsTrigger>
          <TabsTrigger value="routing-config" data-testid="admin-http-tab-routing-config">
            Channels
          </TabsTrigger>
          <TabsTrigger value="location" data-testid="admin-http-tab-location">
            Location
          </TabsTrigger>
          <TabsTrigger value="secrets" data-testid="admin-http-tab-secrets">
            Secrets
          </TabsTrigger>
          <TabsTrigger value="tools" data-testid="admin-http-tab-tools">
            Tools
          </TabsTrigger>
          <TabsTrigger value="device-tokens" data-testid="admin-http-tab-gateway">
            Tokens
          </TabsTrigger>
          <TabsTrigger value="commands" data-testid="admin-ws-tab-commands">
            Commands
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <ConfigureGeneralPanel />
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
