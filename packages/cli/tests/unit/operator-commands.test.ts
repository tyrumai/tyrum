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
type FailureCase = {
  homeAuthToken?: string;
  includeDeviceIdentity: boolean;
  name: string;
  response: unknown;
  spy: ResolvableSpy;
  argv: string[];
  verifyError?: (errSpy: unknown) => void;
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

function failureCase(
  name: string,
  spy: ResolvableSpy,
  response: unknown,
  argv: string[],
  includeDeviceIdentity: boolean,
  homeAuthToken?: string,
  verifyError?: (errSpy: unknown) => void,
): FailureCase {
  return { name, spy, response, argv, includeDeviceIdentity, homeAuthToken, verifyError };
}

const wsSuccessCases = [
  wsSuccessCase(
    "runs `approvals list` via @tyrum/client WS",
    wsApprovalListSpy,
    { approvals: [] },
    ["approvals", "list", "--limit", "10"],
    [{ limit: 10 }],
    "tkn",
  ),
  wsSuccessCase(
    "runs `approvals resolve` via @tyrum/client WS",
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
    "runs `workflow run` via @tyrum/client WS",
    wsWorkflowRunSpy,
    { run_id: "run-1" },
    ["workflow", "run", "--key", "agent:default:main", "--steps", WORKFLOW_STEPS],
    [
      {
        key: "agent:default:main",
        lane: "main",
        steps: [{ type: "Message", args: { text: "hi" } }],
      },
    ],
  ),
  wsSuccessCase(
    "defaults `workflow run` steps args to {}",
    wsWorkflowRunSpy,
    { run_id: "run-1" },
    ["workflow", "run", "--key", "agent:default:main", "--steps", '[{"type":"Message"}]'],
    [{ key: "agent:default:main", lane: "main", steps: [{ type: "Message", args: {} }] }],
  ),
  wsSuccessCase(
    "runs `workflow resume` via @tyrum/client WS",
    wsWorkflowResumeSpy,
    { run_id: "run-1" },
    ["workflow", "resume", "--token", "resume-token"],
    [{ token: "resume-token" }],
  ),
  wsSuccessCase(
    "runs `workflow cancel` via @tyrum/client WS",
    wsWorkflowCancelSpy,
    { run_id: "run-1", cancelled: true },
    ["workflow", "cancel", "--run-id", "run-1", "--reason", "oops"],
    [{ run_id: "run-1", reason: "oops" }],
  ),
] as const;

const wsFailureCases = [
  failureCase(
    "rejects `workflow run` with an invalid --lane",
    wsWorkflowRunSpy,
    { run_id: "run-1" },
    ["workflow", "run", "--key", "agent:default:main", "--lane", "nope", "--steps", WORKFLOW_STEPS],
    true,
  ),
] as const;

const httpSuccessCases = [
  httpSuccessCase(
    "runs `pairing approve` via @tyrum/client HTTP",
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
    "runs `pairing deny` via @tyrum/client HTTP",
    httpPairingsDenySpy,
    { status: "ok" },
    ["pairing", "deny", "--pairing-id", "42", "--reason", "no"],
    [42, { reason: "no" }],
  ),
  httpSuccessCase(
    "runs `pairing revoke` via @tyrum/client HTTP",
    httpPairingsRevokeSpy,
    { status: "ok" },
    ["pairing", "revoke", "--pairing-id", "42", "--reason", "bye"],
    [42, { reason: "bye" }],
  ),
  httpSuccessCase(
    "runs `secrets list` via @tyrum/client HTTP",
    httpSecretsListSpy,
    { handles: [] },
    ["secrets", "list", "--elevated-token", "admin"],
    [],
    "base",
    "admin",
  ),
  httpSuccessCase(
    "runs `secrets store` via @tyrum/client HTTP",
    httpSecretsStoreSpy,
    { handle: { handle_id: "h1" } },
    ["secrets", "store", "--secret-key", "demo", "--value", "secret", "--elevated-token", "admin"],
    [{ secret_key: "demo", value: "secret" }],
    "base",
    "admin",
  ),
  httpSuccessCase(
    "runs `secrets revoke` via @tyrum/client HTTP",
    httpSecretsRevokeSpy,
    { revoked: true },
    ["secrets", "revoke", "--handle-id", "h1", "--elevated-token", "admin"],
    ["h1"],
    "base",
    "admin",
  ),
  httpSuccessCase(
    "runs `secrets rotate` via @tyrum/client HTTP",
    httpSecretsRotateSpy,
    { revoked: true, handle: { handle_id: "h2" } },
    ["secrets", "rotate", "--handle-id", "h1", "--value", "new", "--elevated-token", "admin"],
    ["h1", { value: "new" }],
    "tkn",
    "admin",
  ),
  httpSuccessCase(
    "runs `policy bundle` via @tyrum/client HTTP",
    httpPolicyGetBundleSpy,
    { status: "ok" },
    ["policy", "bundle", "--elevated-token", "admin"],
    [],
    "base",
    "admin",
  ),
  httpSuccessCase(
    "runs `policy overrides list` via @tyrum/client HTTP",
    httpPolicyListOverridesSpy,
    { overrides: [] },
    ["policy", "overrides", "list", "--elevated-token", "admin"],
    [],
    "base",
    "admin",
  ),
  httpSuccessCase(
    "runs `policy overrides create` via @tyrum/client HTTP",
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
    "runs `policy overrides revoke` via @tyrum/client HTTP",
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
    it(testCase.name, async () => {
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

  it("disconnects the WS client when connect fails", async () => {
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
    it(testCase.name, async () => {
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
    it(testCase.name, async () => {
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

  it("rejects `secrets revoke` when --value is provided", async () => {
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
});
