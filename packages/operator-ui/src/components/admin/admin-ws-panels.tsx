import type { OperatorCore } from "@tyrum/operator-core";
import { useRef, useState } from "react";
import { parseJsonInput } from "../../utils/parse-json-input.js";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { JsonTextarea } from "../ui/json-textarea.js";

type PresenceBeaconPayload = Parameters<OperatorCore["ws"]["presenceBeacon"]>[0];
type CapabilityReadyPayload = Parameters<OperatorCore["ws"]["capabilityReady"]>[0];
type AttemptEvidencePayload = Parameters<OperatorCore["ws"]["attemptEvidence"]>[0];

type AsyncResult<T> = {
  busy: boolean;
  value: T | undefined;
  error: unknown | undefined;
  run: (handler: () => Promise<T>) => Promise<void>;
  fail: (error: unknown) => void;
};

function useAsyncResult<T>(): AsyncResult<T> {
  const inFlightRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown | undefined>(undefined);

  const run = async (handler: () => Promise<T>): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setError(undefined);

    try {
      const result = await handler();
      setValue(result);
    } catch (err) {
      setValue(undefined);
      setError(err);
    } finally {
      setBusy(false);
      inFlightRef.current = false;
    }
  };

  const fail = (nextError: unknown): void => {
    setValue(undefined);
    setError(nextError);
  };

  return { busy, value, error, run, fail };
}

type JsonObjectPayloadParseResult =
  | { value: Record<string, unknown>; errorMessage: null }
  | { value: undefined; errorMessage: string };

function parseJsonObjectPayload(raw: string): JsonObjectPayloadParseResult {
  const parsed = parseJsonInput(raw);
  if (parsed.errorMessage) {
    return { value: undefined, errorMessage: `Invalid JSON: ${parsed.errorMessage}` };
  }

  const value = parsed.value === undefined ? {} : parsed.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { value: undefined, errorMessage: "Payload must be a JSON object." };
  }

  return { value: value as Record<string, unknown>, errorMessage: null };
}

function CommandExecutePanel({ core }: { core: OperatorCore }): React.ReactElement {
  const [command, setCommand] = useState("/help");
  const result = useAsyncResult<unknown>();

  return (
    <Card data-testid="admin-ws-command-execute">
      <CardHeader>
        <div className="text-sm font-medium text-fg">command.execute</div>
        <div className="text-sm text-fg-muted">Execute a slash command via the gateway.</div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Input
          label="Command"
          data-testid="admin-ws-command-input"
          value={command}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(event) => {
            setCommand(event.target.value);
          }}
        />

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            isLoading={result.busy}
            data-testid="admin-ws-command-run"
            onClick={() => {
              const trimmed = command.trim();
              if (!trimmed) {
                result.fail("Command is required");
                return;
              }
              if (typeof core.ws.commandExecute !== "function") {
                result.fail("command.execute is not supported by this client.");
                return;
              }

              void result.run(async () => core.ws.commandExecute(trimmed));
            }}
          >
            {result.busy ? "Running..." : "Run"}
          </Button>
        </div>

        <ApiResultCard
          heading="Result"
          value={result.value}
          error={result.error}
          data-testid="admin-ws-command-result"
        />
      </CardContent>
    </Card>
  );
}

function PingPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const result = useAsyncResult<{ latency_ms: number }>();

  return (
    <Card data-testid="admin-ws-ping">
      <CardHeader>
        <div className="text-sm font-medium text-fg">ping</div>
        <div className="text-sm text-fg-muted">Measure gateway round-trip latency.</div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            isLoading={result.busy}
            data-testid="admin-ws-ping-run"
            onClick={() => {
              if (typeof core.ws.ping !== "function") {
                result.fail("ping is not supported by this client.");
                return;
              }

              void result.run(async () => {
                const start = Date.now();
                await core.ws.ping();
                const latencyMs = Math.max(0, Date.now() - start);
                return { latency_ms: latencyMs };
              });
            }}
          >
            {result.busy ? "Pinging..." : "Ping"}
          </Button>
        </div>

        <ApiResultCard
          heading="Result"
          value={result.value}
          error={result.error}
          data-testid="admin-ws-ping-result"
        />
      </CardContent>
    </Card>
  );
}

function PresenceBeaconPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const [rawPayload, setRawPayload] = useState<string>(JSON.stringify({ mode: "ui" }, null, 2));
  const result = useAsyncResult<unknown>();

  return (
    <Card data-testid="admin-ws-presence-beacon">
      <CardHeader>
        <div className="text-sm font-medium text-fg">presence.beacon</div>
        <div className="text-sm text-fg-muted">
          Publish a presence beacon and receive the normalized entry.
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <JsonTextarea
          label="Payload"
          data-testid="admin-ws-presence-beacon-payload"
          value={rawPayload}
          helperText="JSON payload sent to presence.beacon"
          onChange={(event) => {
            setRawPayload(event.target.value);
          }}
        />

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            isLoading={result.busy}
            data-testid="admin-ws-presence-beacon-send"
            onClick={() => {
              if (typeof core.ws.presenceBeacon !== "function") {
                result.fail("presence.beacon is not supported by this client.");
                return;
              }

              const parsed = parseJsonObjectPayload(rawPayload);
              if (parsed.errorMessage !== null) {
                result.fail(parsed.errorMessage);
                return;
              }

              const payload = parsed.value;
              void result.run(async () =>
                core.ws.presenceBeacon(payload as unknown as PresenceBeaconPayload),
              );
            }}
          >
            {result.busy ? "Sending..." : "Send"}
          </Button>
        </div>

        <ApiResultCard
          heading="Result"
          value={result.value}
          error={result.error}
          data-testid="admin-ws-presence-beacon-result"
        />
      </CardContent>
    </Card>
  );
}

function CapabilityReadyPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const [rawPayload, setRawPayload] = useState<string>(
    JSON.stringify({ capabilities: [] }, null, 2),
  );
  const result = useAsyncResult<{ ok: true }>();

  return (
    <Card data-testid="admin-ws-capability-ready">
      <CardHeader>
        <div className="text-sm font-medium text-fg">capability.ready</div>
        <div className="text-sm text-fg-muted">
          Node reporting operation (useful for diagnostics tooling).
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <JsonTextarea
          label="Payload"
          data-testid="admin-ws-capability-ready-payload"
          value={rawPayload}
          helperText="JSON payload sent to capability.ready"
          onChange={(event) => {
            setRawPayload(event.target.value);
          }}
        />

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            isLoading={result.busy}
            data-testid="admin-ws-capability-ready-send"
            onClick={() => {
              if (typeof core.ws.capabilityReady !== "function") {
                result.fail("capability.ready is not supported by this client.");
                return;
              }

              const parsed = parseJsonObjectPayload(rawPayload);
              if (parsed.errorMessage !== null) {
                result.fail(parsed.errorMessage);
                return;
              }

              const payload = parsed.value;
              void result.run(async () => {
                await core.ws.capabilityReady(payload as unknown as CapabilityReadyPayload);
                return { ok: true };
              });
            }}
          >
            {result.busy ? "Sending..." : "Send"}
          </Button>
        </div>

        <ApiResultCard
          heading="Result"
          value={result.value}
          error={result.error}
          data-testid="admin-ws-capability-ready-result"
        />
      </CardContent>
    </Card>
  );
}

function AttemptEvidencePanel({ core }: { core: OperatorCore }): React.ReactElement {
  const [rawPayload, setRawPayload] = useState<string>(
    JSON.stringify({ run_id: "", step_id: "", attempt_id: "", evidence: {} }, null, 2),
  );
  const result = useAsyncResult<{ ok: true }>();

  return (
    <Card data-testid="admin-ws-attempt-evidence">
      <CardHeader>
        <div className="text-sm font-medium text-fg">attempt.evidence</div>
        <div className="text-sm text-fg-muted">
          Node reporting operation (useful for diagnostics tooling).
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <JsonTextarea
          label="Payload"
          data-testid="admin-ws-attempt-evidence-payload"
          value={rawPayload}
          helperText="JSON payload sent to attempt.evidence"
          onChange={(event) => {
            setRawPayload(event.target.value);
          }}
        />

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            isLoading={result.busy}
            data-testid="admin-ws-attempt-evidence-send"
            onClick={() => {
              if (typeof core.ws.attemptEvidence !== "function") {
                result.fail("attempt.evidence is not supported by this client.");
                return;
              }

              const parsed = parseJsonObjectPayload(rawPayload);
              if (parsed.errorMessage !== null) {
                result.fail(parsed.errorMessage);
                return;
              }

              const payload = parsed.value;
              void result.run(async () => {
                await core.ws.attemptEvidence(payload as unknown as AttemptEvidencePayload);
                return { ok: true };
              });
            }}
          >
            {result.busy ? "Sending..." : "Send"}
          </Button>
        </div>

        <ApiResultCard
          heading="Result"
          value={result.value}
          error={result.error}
          data-testid="admin-ws-attempt-evidence-result"
        />
      </CardContent>
    </Card>
  );
}

export function AdminWsPanels({ core }: { core: OperatorCore }): React.ReactElement {
  return (
    <div className="grid gap-6" data-testid="admin-ws-panels">
      <section className="grid gap-3" aria-label="Commands">
        <div className="text-sm font-medium text-fg">Commands</div>
        <div className="grid gap-3">
          <CommandExecutePanel core={core} />
          <PingPanel core={core} />
          <PresenceBeaconPanel core={core} />
        </div>
      </section>

      <section className="grid gap-3" aria-label="Diagnostics">
        <div className="text-sm font-medium text-fg">Diagnostics</div>
        <div className="grid gap-3">
          <CapabilityReadyPanel core={core} />
          <AttemptEvidencePanel core={core} />
        </div>
      </section>
    </div>
  );
}
