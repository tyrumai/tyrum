import type { OperatorCore } from "@tyrum/operator-core";
import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ResolvedTuiConfig } from "./config.js";

type RouteId = "connect" | "status";

function useOperatorStore<T>(store: {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
}): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function AppHeader({ title }: { title: string }) {
  return (
    <Box flexDirection="column" paddingBottom={1}>
      <Text bold>{title}</Text>
      <Text dimColor>Keys: c=connect d=disconnect 1=connect 2=status q=quit</Text>
    </Box>
  );
}

function ConnectScreen({
  core,
  config,
}: {
  core: OperatorCore;
  config: Pick<ResolvedTuiConfig, "httpBaseUrl" | "wsUrl" | "deviceIdentityPath">;
}) {
  const connection = useOperatorStore(core.connectionStore);

  return (
    <Box flexDirection="column">
      <Text>
        Gateway: <Text bold>{config.httpBaseUrl}</Text>
      </Text>
      <Text>
        WS: <Text bold>{config.wsUrl}</Text>
      </Text>
      <Text>
        Device identity: <Text bold>{config.deviceIdentityPath}</Text>
      </Text>

      <Box flexDirection="column" paddingTop={1}>
        <Text>
          Status: <Text bold>{connection.status}</Text>
        </Text>
        {connection.clientId ? (
          <Text>
            Client ID: <Text bold>{connection.clientId}</Text>
          </Text>
        ) : null}
        {connection.transportError ? (
          <Text color="red">Transport error: {connection.transportError}</Text>
        ) : null}
        {connection.lastDisconnect ? (
          <Text color="red">
            Last disconnect: {String(connection.lastDisconnect.code)}{" "}
            {connection.lastDisconnect.reason}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}

function StatusScreen({ core }: { core: OperatorCore }) {
  const connection = useOperatorStore(core.connectionStore);
  const approvals = useOperatorStore(core.approvalsStore);
  const pairing = useOperatorStore(core.pairingStore);
  const status = useOperatorStore(core.statusStore);

  const pendingApprovals = approvals.pendingIds.length;
  const pendingPairings = pairing.pendingIds.length;
  const presenceCount = useMemo(
    () => Object.keys(status.presenceByInstanceId).length,
    [status.presenceByInstanceId],
  );

  return (
    <Box flexDirection="column">
      <Text>
        Connection: <Text bold>{connection.status}</Text>
      </Text>
      <Text>Pending approvals: {String(pendingApprovals)}</Text>
      <Text>Pending pairings: {String(pendingPairings)}</Text>
      <Text>Presence entries: {String(presenceCount)}</Text>
    </Box>
  );
}

export function TuiApp({ core, config }: { core: OperatorCore; config: ResolvedTuiConfig }) {
  const { exit } = useApp();
  const [route, setRoute] = useState<RouteId>("connect");

  useEffect(() => {
    core.connect();
    return () => {
      core.disconnect();
    };
  }, [core]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    switch (input) {
      case "q":
        exit();
        return;
      case "c":
        core.connect();
        return;
      case "d":
        core.disconnect();
        return;
      case "1":
        setRoute("connect");
        return;
      case "2":
        setRoute("status");
        return;
      default:
        break;
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <AppHeader title={`Tyrum TUI (${route})`} />
      {route === "connect" ? (
        <ConnectScreen core={core} config={config} />
      ) : (
        <StatusScreen core={core} />
      )}
    </Box>
  );
}
