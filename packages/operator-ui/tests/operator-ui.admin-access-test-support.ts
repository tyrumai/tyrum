import {
  createBearerTokenAuth,
  createElevatedModeStore,
  createOperatorCore,
} from "../../operator-app/src/index.js";
import type { OperatorHttpClient, OperatorWsClient } from "../../operator-app/src/deps.js";

const TEST_ELEVATED_MODE_ENTERED_AT = "2026-01-01T00:00:00.000Z";
const TEST_ELEVATED_MODE_EXPIRES_AT = "2026-01-01T00:10:00.000Z";

export function createOperatorUiTestCoreWithAdminAccess(input: {
  ws: OperatorWsClient;
  http: OperatorHttpClient;
}) {
  const elevatedModeStore = createElevatedModeStore({
    tickIntervalMs: 0,
    now: () => Date.parse(TEST_ELEVATED_MODE_ENTERED_AT),
  });
  elevatedModeStore.enter({
    elevatedToken: "test-elevated-token",
    expiresAt: TEST_ELEVATED_MODE_EXPIRES_AT,
  });

  return createOperatorCore({
    wsUrl: "ws://example.test/ws",
    httpBaseUrl: "http://example.test",
    auth: createBearerTokenAuth("test"),
    elevatedModeStore,
    deps: {
      ws: input.ws,
      http: input.http,
      createPrivilegedWs: () => input.ws,
      createPrivilegedHttp: () => input.http,
    },
  });
}
