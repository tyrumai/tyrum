import { afterEach, describe, expect, it } from "vitest";
import {
  expectBearerHttpCtor,
  expectDefaultWsCtor,
  httpPairingsApproveSpy,
  httpPairingsDenySpy,
  httpPairingsRevokeSpy,
  httpPolicyCreateOverrideSpy,
  httpPolicyGetBundleSpy,
  httpPolicyListOverridesSpy,
  httpPolicyRevokeOverrideSpy,
  httpSecretsListSpy,
  httpSecretsRevokeSpy,
  httpSecretsRotateSpy,
  httpSecretsStoreSpy,
  resetOperatorCommandSpies,
  setWsConnectMode,
  withOperatorCli,
  wsApprovalListSpy,
  wsApprovalResolveSpy,
  wsDisconnectSpy,
  wsWorkflowCancelSpy,
  wsWorkflowResumeSpy,
  wsWorkflowRunSpy,
} from "./operator-commands.test-support.js";

type ResolvableSpy = { mockResolvedValue(value: unknown): unknown };
type SuccessCase = {
  expectedCall: unknown[];
  expectedCtorToken?: string;
  homeAuthToken?: string;
  name: string;
  response: unknown;
  spy: ResolvableSpy;
  argv: string[];
};

type WsFailureCase = {
  name: string;
  argv: string[];
  spy: ResolvableSpy;
  response: unknown;
  homeAuthToken?: string;
  includeDeviceIdentity?: boolean;
  verifyError?: (errSpy: { mock: { calls: unknown[] } }) => void;
};

const APPROVAL_ID = "550e8400-e29b-41d4-a716-446655440000";
const WORKFLOW_STEPS = '[{"type":"Message","args":{"text":"hi"}}]';

function wsSuccessCase(
  name: string,
  spy: ResolvableSpy,
  response: unknown,
  argv: string[],
  expectedCall: unknown[],
  expectedCtorToken?: string,
): SuccessCase {
  return { name, spy, response, argv, expectedCall, expectedCtorToken };
}

function httpSuccessCase(
  name: string,
  spy: ResolvableSpy,
  response: unknown,
  argv: string[],
  expectedCall: unknown[],
  homeAuthToken = "tkn",
  expectedCtorToken = homeAuthToken,
): SuccessCase {
  return { name, spy, response, argv, expectedCall, homeAuthToken, expectedCtorToken };
}

const wsSuccessCases = [
  wsSuccessCase(
    "runs `approvals list` via @tyrum/operator-app/node WS",
    wsApprovalListSpy,
    { approvals: [] },
    ["approvals", "list", "--limit", "10"],
    [{ limit: 10 }],
    "tkn",
  ),
  wsSuccessCase(
    "runs `approvals resolve` via @tyrum/operator-app/node WS",
    wsApprovalResolveSpy,
    { approval: { approval_id: APPROVAL_ID } },
    [
      "approvals",
      "resolve",
      "--approval-id",
      APPROVAL_ID,
      "--decision",
      "approved",
      "--reason",
      "ok",
    ],
    [{ approval_id: APPROVAL_ID, decision: "approved", reason: "ok" }],
  ),
  wsSuccessCase(
    "runs `workflow start` via @tyrum/operator-app/node WS",
    wsWorkflowRunSpy,
    { turn_id: "run-1" },
    ["workflow", "start", "--conversation-key", "agent:default:main", "--steps", WORKFLOW_STEPS],
    [
      {
        conversation_key: "agent:default:main",
        steps: [{ type: "Message", args: { text: "hi" } }],
      },
    ],
  ),
  wsSuccessCase(
    "defaults `workflow start` steps args to {}",
    wsWorkflowRunSpy,
    { turn_id: "run-1" },
    [
      "workflow",
      "start",
      "--conversation-key",
      "agent:default:main",
      "--steps",
      '[{"type":"Message"}]',
    ],
    [{ conversation_key: "agent:default:main", steps: [{ type: "Message", args: {} }] }],
  ),
  wsSuccessCase(
    "runs `workflow resume` via @tyrum/operator-app/node WS",
    wsWorkflowResumeSpy,
    { turn_id: "run-1" },
    ["workflow", "resume", "--token", "resume-token"],
    [{ token: "resume-token" }],
  ),
  wsSuccessCase(
    "runs `workflow cancel` via @tyrum/operator-app/node WS",
    wsWorkflowCancelSpy,
    { workflow_run_id: "run-1", cancelled: true },
    ["workflow", "cancel", "--workflow-run-id", "run-1", "--reason", "oops"],
    [{ workflow_run_id: "run-1", reason: "oops" }],
  ),
] as const;

const wsFailureCases: readonly WsFailureCase[] = [];

const httpSuccessCases = [
  httpSuccessCase(
    "runs `pairing approve` via @tyrum/operator-app/node HTTP",
    httpPairingsApproveSpy,
    { status: "ok" },
    [
      "pairing",
      "approve",
      "--pairing-id",
      "42",
      "--trust-level",
      "local",
      "--capability",
      "tyrum.cli",
      "--reason",
      "ok",
    ],
    [
      42,
      {
        trust_level: "local",
        capability_allowlist: [{ id: "tyrum.cli", version: "1.0.0" }],
        reason: "ok",
      },
    ],
  ),
  httpSuccessCase(
    "runs `pairing deny` via @tyrum/operator-app/node HTTP",
    httpPairingsDenySpy,
    { status: "ok" },
    ["pairing", "deny", "--pairing-id", "42", "--reason", "no"],
    [42, { reason: "no" }],
  ),
  httpSuccessCase(
    "runs `pairing revoke` via @tyrum/operator-app/node HTTP",
    httpPairingsRevokeSpy,
    { status: "ok" },
    ["pairing", "revoke", "--pairing-id", "42", "--reason", "bye"],
    [42, { reason: "bye" }],
  ),
  httpSuccessCase(
    "runs `secrets list` via @tyrum/operator-app/node HTTP",
    httpSecretsListSpy,
    { handles: [] },
    ["secrets", "list", "--elevated-token", "admin"],
    [],
    "base",
    "admin",
  ),
  httpSuccessCase(
    "runs `secrets store` via @tyrum/operator-app/node HTTP",
    httpSecretsStoreSpy,
    { handle: { handle_id: "h1" } },
    ["secrets", "store", "--secret-key", "demo", "--value", "secret", "--elevated-token", "admin"],
    [{ secret_key: "demo", value: "secret" }],
    "base",
    "admin",
  ),
  httpSuccessCase(
    "runs `secrets revoke` via @tyrum/operator-app/node HTTP",
    httpSecretsRevokeSpy,
    { revoked: true },
    ["secrets", "revoke", "--handle-id", "h1", "--elevated-token", "admin"],
    ["h1"],
    "base",
    "admin",
  ),
  httpSuccessCase(
    "runs `secrets rotate` via @tyrum/operator-app/node HTTP",
    httpSecretsRotateSpy,
    { revoked: true, handle: { handle_id: "h2" } },
    ["secrets", "rotate", "--handle-id", "h1", "--value", "new", "--elevated-token", "admin"],
    ["h1", { value: "new" }],
    "tkn",
    "admin",
  ),
  httpSuccessCase(
    "runs `policy bundle` via @tyrum/operator-app/node HTTP",
    httpPolicyGetBundleSpy,
    { status: "ok" },
    ["policy", "bundle", "--elevated-token", "admin"],
    [],
    "base",
    "admin",
  ),
  httpSuccessCase(
    "runs `policy overrides list` via @tyrum/operator-app/node HTTP",
    httpPolicyListOverridesSpy,
    { overrides: [] },
    ["policy", "overrides", "list", "--elevated-token", "admin"],
    [],
    "base",
    "admin",
  ),
  httpSuccessCase(
    "runs `policy overrides create` via @tyrum/operator-app/node HTTP",
    httpPolicyCreateOverrideSpy,
    { override: { policy_override_id: "p1" } },
    [
      "policy",
      "overrides",
      "create",
      "--agent-id",
      "default",
      "--tool-id",
      "system.shell.exec",
      "--pattern",
      "*",
      "--elevated-token",
      "admin",
    ],
    [{ agent_id: "default", tool_id: "system.shell.exec", pattern: "*" }],
    "base",
    "admin",
  ),
  httpSuccessCase(
    "runs `policy overrides revoke` via @tyrum/operator-app/node HTTP",
    httpPolicyRevokeOverrideSpy,
    { override: { policy_override_id: "p1" } },
    [
      "policy",
      "overrides",
      "revoke",
      "--policy-override-id",
      "p1",
      "--reason",
      "bad",
      "--elevated-token",
      "admin",
    ],
    [{ policy_override_id: "p1", reason: "bad" }],
    "base",
    "admin",
  ),
] as const;

describe("@tyrum/cli operator commands", () => {
  const prevHome = process.env["TYRUM_HOME"];

  afterEach(() => {
    resetOperatorCommandSpies();
    if (prevHome === undefined) delete process.env["TYRUM_HOME"];
    else process.env["TYRUM_HOME"] = prevHome;
  });

  for (const testCase of wsSuccessCases) {
    it(testCase.name, { timeout: 15_000 }, async () => {
      testCase.spy.mockResolvedValue(testCase.response);

      await withOperatorCli({ includeDeviceIdentity: true }, async ({ runCli, logSpy, errSpy }) => {
        const code = await runCli(testCase.argv);

        expect(code).toBe(0);
        expect(errSpy).not.toHaveBeenCalled();
        if (testCase.expectedCtorToken) expectDefaultWsCtor(testCase.expectedCtorToken);
        expect(testCase.spy).toHaveBeenCalledWith(...testCase.expectedCall);
        expect(logSpy).toHaveBeenCalled();
      });
    });
  }

  it("disconnects the WS client when connect fails", { timeout: 15_000 }, async () => {
    setWsConnectMode("transport_error");

    await withOperatorCli({ includeDeviceIdentity: true }, async ({ runCli, logSpy, errSpy }) => {
      const code = await runCli(["approvals", "list", "--limit", "10"]);

      expect(code).toBe(1);
      expect(errSpy).toHaveBeenCalled();
      expect(wsApprovalListSpy).not.toHaveBeenCalled();
      expect(wsDisconnectSpy).toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  for (const testCase of wsFailureCases) {
    it(testCase.name, { timeout: 15_000 }, async () => {
      testCase.spy.mockResolvedValue(testCase.response);

      await withOperatorCli(
        {
          authToken: testCase.homeAuthToken,
          includeDeviceIdentity: testCase.includeDeviceIdentity,
        },
        async ({ runCli, errSpy }) => {
          const code = await runCli(testCase.argv);

          expect(code).toBe(1);
          expect(testCase.spy).not.toHaveBeenCalled();
          if (testCase.verifyError) testCase.verifyError(errSpy);
          else expect(errSpy).toHaveBeenCalled();
        },
      );
    });
  }

  for (const testCase of httpSuccessCases) {
    it(testCase.name, { timeout: 15_000 }, async () => {
      testCase.spy.mockResolvedValue(testCase.response);

      await withOperatorCli(
        { authToken: testCase.homeAuthToken, includeDeviceIdentity: false },
        async ({ runCli, logSpy, errSpy }) => {
          const code = await runCli(testCase.argv);

          expect(code).toBe(0);
          expect(errSpy).not.toHaveBeenCalled();
          expectBearerHttpCtor(testCase.expectedCtorToken ?? testCase.homeAuthToken ?? "tkn");
          expect(testCase.spy).toHaveBeenCalledWith(...testCase.expectedCall);
          expect(logSpy).toHaveBeenCalled();
        },
      );
    });
  }

  it("rejects `secrets revoke` when --value is provided", { timeout: 15_000 }, async () => {
    httpSecretsRevokeSpy.mockResolvedValue({ revoked: true });

    await withOperatorCli(
      { authToken: "base", includeDeviceIdentity: false },
      async ({ runCli, errSpy }) => {
        const code = await runCli([
          "secrets",
          "revoke",
          "--handle-id",
          "h1",
          "--value",
          "new-secret",
        ]);

        expect(code).toBe(1);
        expect(httpSecretsRevokeSpy).not.toHaveBeenCalled();
        expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("--value"));
      },
    );
  });

  it("does not label non-http coded errors as status=unknown", { timeout: 15_000 }, async () => {
    httpSecretsListSpy.mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8788"), {
        code: "ECONNREFUSED",
      }),
    );

    await withOperatorCli(
      { authToken: "base", includeDeviceIdentity: false },
      async ({ runCli, errSpy, logSpy }) => {
        const code = await runCli(["secrets", "list", "--elevated-token", "admin"]);

        expect(code).toBe(1);
        expect(logSpy).not.toHaveBeenCalled();
        expect(errSpy).toHaveBeenCalledWith("secrets: failed: connect ECONNREFUSED 127.0.0.1:8788");
      },
    );
  });
});
