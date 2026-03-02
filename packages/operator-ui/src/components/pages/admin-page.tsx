import type { OperatorCore } from "@tyrum/operator-core";
import { AuditPanel } from "../admin-http/audit-panel.js";
import { PageHeader } from "../layout/page-header.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { useAdminMutationAccess } from "./admin-http-shared.js";
import { DeviceTokensCard } from "./admin-http-device-tokens.js";
import { AdminHttpModelsRefreshPanel } from "./admin-http-models-refresh.js";
import { PluginsCard } from "./admin-http-plugins.js";
import { AdminHttpPolicyAuthPanels } from "./admin-http-policy-auth-panels.js";
import { AdminHttpRoutingConfigPanel } from "./admin-http-routing-config.js";
import { AdminHttpSecretsPanel } from "./admin-http-secrets.js";
import { AdminWsCommandPanel } from "./admin-ws-command-panel.js";

export interface AdminPageProps {
  core: OperatorCore;
}

function ReadOnlyNotice({ onEnterAdminMode }: { onEnterAdminMode: () => void }) {
  return (
    <div className="grid gap-3" data-testid="admin-read-only-notice">
      <Alert
        variant="info"
        title="Read-only mode"
        description="All admin settings are visible. Enter Admin Mode to enable mutation actions."
      />
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-testid="admin-read-only-enter"
          onClick={() => {
            onEnterAdminMode();
          }}
        >
          Enter Admin Mode
        </Button>
      </div>
    </div>
  );
}

export function AdminPage({ core }: AdminPageProps) {
  const { canMutate, requestEnter } = useAdminMutationAccess(core);

  return (
    <div className="grid gap-6" data-testid="admin-page">
      <PageHeader title="Admin" />

      {!canMutate ? (
        <ReadOnlyNotice
          onEnterAdminMode={() => {
            requestEnter();
          }}
        />
      ) : null}

      <Tabs defaultValue="policy-auth" className="grid gap-3">
        <TabsList aria-label="Admin sections">
          <TabsTrigger value="policy-auth" data-testid="admin-http-tab-policy-auth">
            Policy + Auth
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="admin-http-tab-audit">
            Audit
          </TabsTrigger>
          <TabsTrigger value="routing-config" data-testid="admin-http-tab-routing-config">
            Routing config
          </TabsTrigger>
          <TabsTrigger value="secrets" data-testid="admin-http-tab-secrets">
            Secrets
          </TabsTrigger>
          <TabsTrigger value="plugins" data-testid="admin-http-tab-plugins">
            Plugins
          </TabsTrigger>
          <TabsTrigger value="device-tokens" data-testid="admin-http-tab-gateway">
            Device tokens
          </TabsTrigger>
          <TabsTrigger value="models-refresh" data-testid="admin-http-tab-models-refresh">
            Models refresh
          </TabsTrigger>
          <TabsTrigger value="commands" data-testid="admin-ws-tab-commands">
            Commands
          </TabsTrigger>
        </TabsList>

        <TabsContent value="policy-auth">
          <AdminHttpPolicyAuthPanels core={core} />
        </TabsContent>

        <TabsContent value="audit">
          <AuditPanel core={core} />
        </TabsContent>

        <TabsContent value="routing-config">
          <AdminHttpRoutingConfigPanel core={core} />
        </TabsContent>

        <TabsContent value="secrets">
          <AdminHttpSecretsPanel core={core} />
        </TabsContent>

        <TabsContent value="plugins">
          <PluginsCard core={core} />
        </TabsContent>

        <TabsContent value="device-tokens">
          <DeviceTokensCard core={core} />
        </TabsContent>

        <TabsContent value="models-refresh">
          <AdminHttpModelsRefreshPanel core={core} />
        </TabsContent>

        <TabsContent value="commands">
          <AdminWsCommandPanel core={core} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
