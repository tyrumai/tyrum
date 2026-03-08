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

export interface AdminHttpAuthPinsCardProps {
  http: AdminHttpClient;
  openMutation: OpenMutation;
  canMutate: boolean;
}

export function AdminHttpAuthPinsCard({
  http,
  openMutation,
  canMutate,
}: AdminHttpAuthPinsCardProps) {
  const pins = useApiResultState("Auth pins");
  const listPinsQuery = useJsonInputState("{}");
  const setPinBody = useJsonInputState(
    JSON.stringify(
      {
        session_id: "session-1",
        provider: "provider-1",
        profile_id: "00000000-0000-0000-0000-000000000000",
      },
      null,
      2,
    ),
  );

  return (
    <Card data-testid="admin-http-auth-pins">
      <CardHeader className="pb-2.5">
        <div className="text-sm font-medium text-fg">Auth pins</div>
        <div className="text-sm text-fg-muted">
          Pin sessions/providers to a specific auth profile.
        </div>
      </CardHeader>
      <CardContent className="grid gap-6">
        <Alert
          variant="warning"
          title="Global impact"
          description="Pins affect routing for live sessions across the gateway instance."
        />

        <AuthPinsListRow http={http} busy={pins.state.busy} run={pins.run} query={listPinsQuery} />

        <Separator />

        <AuthPinsSetRow
          http={http}
          run={pins.run}
          body={setPinBody}
          openMutation={openMutation}
          canMutate={canMutate}
        />

        <ApiResultCard
          heading={pins.state.heading}
          value={pins.state.value}
          error={pins.state.error}
        />
      </CardContent>
    </Card>
  );
}

function AuthPinsListRow({
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
        data-testid="admin-auth-pins-list-query"
        label="List query (optional)"
        placeholder="{}"
        state={query}
      />

      <div className="flex items-end">
        <Button
          data-testid="admin-auth-pins-list"
          variant="secondary"
          isLoading={busy}
          disabled={query.errorMessage !== null}
          onClick={() => {
            const value = resolveJsonValue(query, {});
            void run("Auth pins", async () => await http.authPins.list(value as never));
          }}
        >
          List pins
        </Button>
      </div>
    </div>
  );
}

function AuthPinsSetRow({
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
        data-testid="admin-auth-pins-set-json"
        label="Set pin JSON"
        helperText="Set profile_id to null to clear a pin."
        state={body}
      />

      <div className="flex items-end">
        <Button
          data-testid="admin-auth-pins-set"
          variant="danger"
          disabled={!canMutate || body.errorMessage !== null || typeof body.value === "undefined"}
          onClick={() => {
            const input = resolveJsonValue(body, undefined);
            openMutation({
              title: "Set auth pin",
              description: "Pins affect live sessions globally for the gateway instance.",
              confirmLabel: "Set pin",
              content: <JsonViewer value={input} />,
              onConfirm: async () => {
                const outcome = await run("Auth pin updated", async () => {
                  return await http.authPins.set(input as never);
                });
                if (!outcome.ok) throw outcome.error;
              },
            });
          }}
        >
          Set / clear pin
        </Button>
      </div>
    </div>
  );
}
