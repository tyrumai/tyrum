import { ApiResultCard } from "../ui/api-result-card.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { JsonViewer } from "../ui/json-viewer.js";
import { Separator } from "../ui/separator.js";
import type { AdminHttpClient } from "./admin-http-shared.js";
import {
  JsonInput,
  resolveJsonValue,
  useApiResultState,
  useJsonInputState,
  type ApiRunner,
  type JsonInputState,
  type OpenMutation,
} from "./admin-http-panels.shared.js";

export interface AdminHttpPolicyCardProps {
  http: AdminHttpClient;
  openMutation: OpenMutation;
  canMutate: boolean;
}

export function AdminHttpPolicyCard({ http, openMutation, canMutate }: AdminHttpPolicyCardProps) {
  return (
    <Card data-testid="admin-http-policy">
      <CardHeader className="pb-4">
        <div className="text-sm font-medium text-fg">Policy</div>
        <div className="text-sm text-fg-muted">
          View the effective policy bundle and manage overrides.
        </div>
      </CardHeader>
      <CardContent className="grid gap-6">
        <PolicyBundleSection http={http} />
        <Separator />
        <PolicyOverridesSection http={http} openMutation={openMutation} canMutate={canMutate} />
      </CardContent>
    </Card>
  );
}

function PolicyBundleSection({ http }: { http: AdminHttpClient }) {
  const bundle = useApiResultState("Policy bundle");

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <div className="text-sm font-medium text-fg">Effective bundle</div>
          <div className="text-xs text-fg-muted">
            Resolved deployment + agent + playbook policy bundle.
          </div>
        </div>
        <Button
          data-testid="admin-policy-bundle-fetch"
          variant="secondary"
          isLoading={bundle.state.busy}
          onClick={() => {
            void bundle.run("Policy bundle", async () => await http.policy.getBundle());
          }}
        >
          Fetch bundle
        </Button>
      </div>

      <ApiResultCard
        heading={bundle.state.heading}
        value={bundle.state.value}
        error={bundle.state.error}
      />
    </div>
  );
}

function PolicyOverridesSection({
  http,
  openMutation,
  canMutate,
}: {
  http: AdminHttpClient;
  openMutation: OpenMutation;
  canMutate: boolean;
}) {
  const overrides = useApiResultState("Policy overrides");
  const listOverridesQuery = useJsonInputState("{}");
  const createOverrideBody = useJsonInputState(
    JSON.stringify(
      {
        agent_id: "00000000-0000-4000-8000-000000000002",
        tool_id: "tool-1",
        pattern: ".*",
      },
      null,
      2,
    ),
  );
  const revokeOverrideBody = useJsonInputState(
    JSON.stringify(
      { policy_override_id: "00000000-0000-0000-0000-000000000000", reason: "No longer needed" },
      null,
      2,
    ),
  );

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <div className="text-sm font-medium text-fg">Overrides</div>
        <div className="text-xs text-fg-muted">
          Overrides have global impact across the gateway instance.
        </div>
      </div>

      <Alert
        variant="warning"
        title="Global impact"
        description="Policy overrides apply to all operators and runs. Use short TTLs when possible."
      />

      <PolicyOverridesListRow
        http={http}
        busy={overrides.state.busy}
        run={overrides.run}
        query={listOverridesQuery}
      />

      <PolicyOverrideCreateRow
        http={http}
        run={overrides.run}
        body={createOverrideBody}
        openMutation={openMutation}
        canMutate={canMutate}
      />

      <PolicyOverrideRevokeRow
        http={http}
        run={overrides.run}
        body={revokeOverrideBody}
        openMutation={openMutation}
        canMutate={canMutate}
      />

      <ApiResultCard
        heading={overrides.state.heading}
        value={overrides.state.value}
        error={overrides.state.error}
      />
    </div>
  );
}

function PolicyOverridesListRow({
  http,
  busy,
  run,
  query,
}: {
  http: AdminHttpClient;
  busy: boolean;
  run: ApiRunner;
  query: JsonInputState;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <JsonInput
        data-testid="admin-policy-overrides-list-query"
        label="List query (optional)"
        placeholder="{}"
        state={query}
      />

      <div className="flex items-end">
        <Button
          data-testid="admin-policy-overrides-list"
          variant="secondary"
          isLoading={busy}
          disabled={query.errorMessage !== null}
          onClick={() => {
            const value = resolveJsonValue(query, {});
            void run(
              "Policy overrides",
              async () => await http.policy.listOverrides(value as never),
            );
          }}
        >
          List overrides
        </Button>
      </div>
    </div>
  );
}

function PolicyOverrideCreateRow({
  http,
  run,
  body,
  openMutation,
  canMutate,
}: {
  http: AdminHttpClient;
  run: ApiRunner;
  body: JsonInputState;
  openMutation: OpenMutation;
  canMutate: boolean;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <JsonInput
        data-testid="admin-policy-override-create-json"
        label="Create override JSON"
        state={body}
      />

      <div className="flex items-end gap-2">
        <Button
          data-testid="admin-policy-override-create"
          variant="danger"
          disabled={!canMutate || body.errorMessage !== null || typeof body.value === "undefined"}
          onClick={() => {
            const input = resolveJsonValue(body, undefined);
            openMutation({
              title: "Create policy override",
              description: "This affects policy globally for the gateway instance.",
              confirmLabel: "Create override",
              content: <JsonViewer value={input} />,
              onConfirm: async () => {
                const outcome = await run("Policy override created", async () => {
                  return await http.policy.createOverride(input as never);
                });
                if (!outcome.ok) throw outcome.error;
              },
            });
          }}
        >
          Create override
        </Button>
      </div>
    </div>
  );
}

function PolicyOverrideRevokeRow({
  http,
  run,
  body,
  openMutation,
  canMutate,
}: {
  http: AdminHttpClient;
  run: ApiRunner;
  body: JsonInputState;
  openMutation: OpenMutation;
  canMutate: boolean;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <JsonInput
        data-testid="admin-policy-override-revoke-json"
        label="Revoke override JSON"
        state={body}
      />

      <div className="flex items-end gap-2">
        <Button
          data-testid="admin-policy-override-revoke"
          variant="danger"
          disabled={!canMutate || body.errorMessage !== null || typeof body.value === "undefined"}
          onClick={() => {
            const input = resolveJsonValue(body, undefined);
            openMutation({
              title: "Revoke policy override",
              description: "This affects policy globally for the gateway instance.",
              confirmLabel: "Revoke override",
              content: <JsonViewer value={input} />,
              onConfirm: async () => {
                const outcome = await run("Policy override revoked", async () => {
                  return await http.policy.revokeOverride(input as never);
                });
                if (!outcome.ok) throw outcome.error;
              },
            });
          }}
        >
          Revoke override
        </Button>
      </div>
    </div>
  );
}
