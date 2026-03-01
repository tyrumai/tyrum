import type { OperatorCore } from "@tyrum/operator-core";
import { AdminModeGate } from "../../admin-mode.js";
import { PageHeader } from "../layout/page-header.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";

export interface AdminPageProps {
  core: OperatorCore;
  onNavigate?: (id: string) => void;
}

const QUICK_LINKS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "memory", label: "Memory" },
  { id: "approvals", label: "Approvals" },
  { id: "runs", label: "Runs" },
  { id: "pairing", label: "Pairing" },
  { id: "settings", label: "Settings" },
] as const;

export function AdminPage({ onNavigate }: AdminPageProps) {
  return (
    <div className="grid gap-6" data-testid="admin-page">
      <PageHeader title="Admin" />

      <section className="grid gap-2" aria-label="Operator shortcuts">
        <div className="text-sm font-medium text-fg">Shortcuts</div>
        <div className="flex flex-wrap gap-2">
          {QUICK_LINKS.map((link) => (
            <Button
              key={link.id}
              type="button"
              variant="secondary"
              onClick={() => {
                onNavigate?.(link.id);
              }}
            >
              {link.label}
            </Button>
          ))}
        </div>
      </section>

      <Tabs defaultValue="http" className="grid gap-3">
        <TabsList aria-label="Admin panel type">
          <TabsTrigger value="http" data-testid="admin-tab-http">
            HTTP
          </TabsTrigger>
          <TabsTrigger value="ws" data-testid="admin-tab-ws">
            WebSocket
          </TabsTrigger>
        </TabsList>

        <AdminModeGate>
          <TabsContent value="http">
            <Card>
              <CardHeader>
                <div className="text-sm font-medium text-fg">HTTP</div>
              </CardHeader>
              <CardContent className="text-sm text-fg-muted">
                Admin HTTP panels will appear here.
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ws">
            <Card>
              <CardHeader>
                <div className="text-sm font-medium text-fg">WebSocket</div>
              </CardHeader>
              <CardContent className="text-sm text-fg-muted">
                Admin WebSocket panels will appear here.
              </CardContent>
            </Card>
          </TabsContent>
        </AdminModeGate>
      </Tabs>
    </div>
  );
}
