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
  wsMemoryCreateSpy,
  wsMemoryDeleteSpy,
  wsMemoryExportSpy,
  wsMemoryForgetSpy,
  wsMemoryGetSpy,
  wsMemoryListSpy,
  wsMemorySearchSpy,
  wsMemoryUpdateSpy,
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
const MEMORY_ITEM_ID = "00000000-0000-0000-0000-000000000001";
const MEMORY_SELECTORS = [{ kind: "id", memory_item_id: MEMORY_ITEM_ID }],
  WORKFLOW_STEPS = '[{"type":"Message","args":{"text":"hi"}}]';

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
    "runs `memory search` via @tyrum/client WS",
    wsMemorySearchSpy,
    { v: 1, hits: [] },
    ["memory", "search", "--query", "hello"],
    [{ v: 1, query: "hello" }],
  ),
  wsSuccessCase(
    "passes optional flags to `memory search` via @tyrum/client WS",
    wsMemorySearchSpy,
    { v: 1, hits: [] },
    [
      "memory",
      "search",
      "--query",
      "hello",
      "--limit",
      "5",
      "--cursor",
      "cur",
      "--filter",
      JSON.stringify({ kinds: ["note"] }),
    ],
    [{ v: 1, query: "hello", limit: 5, cursor: "cur", filter: { kinds: ["note"] } }],
  ),
  wsSuccessCase(
    "runs `memory list` via @tyrum/client WS",
    wsMemoryListSpy,
    { v: 1, items: [] },
    ["memory", "list", "--limit", "10"],
    [{ v: 1, limit: 10 }],
  ),
  wsSuccessCase(
    "runs `memory read` via @tyrum/client WS",
    wsMemoryGetSpy,
    { v: 1, item: { kind: "note" } },
    ["memory", "read", "--id", MEMORY_ITEM_ID],
    [{ v: 1, memory_item_id: MEMORY_ITEM_ID }],
  ),
  wsSuccessCase(
    "runs `memory create` via @tyrum/client WS",
    wsMemoryCreateSpy,
    { v: 1, item: { kind: "note" } },
    ["memory", "create", "--item", JSON.stringify({ kind: "note", body_md: "hello" })],
    [
      {
        v: 1,
        item: {
          kind: "note",
          body_md: "hello",
          provenance: { source_kind: "operator", channel: "cli" },
        },
      },
    ],
  ),
  wsSuccessCase(
    "runs `memory update` via @tyrum/client WS",
    wsMemoryUpdateSpy,
    { v: 1, item: { kind: "note" } },
    ["memory", "update", "--id", MEMORY_ITEM_ID, "--patch", JSON.stringify({ tags: ["a"] })],
    [{ v: 1, memory_item_id: MEMORY_ITEM_ID, patch: { tags: ["a"] } }],
  ),
  wsSuccessCase(
    "runs `memory delete` via @tyrum/client WS",
    wsMemoryDeleteSpy,
    { v: 1, tombstone: { memory_item_id: "m1" } },
    ["memory", "delete", "--id", MEMORY_ITEM_ID, "--reason", "cleanup"],
    [{ v: 1, memory_item_id: MEMORY_ITEM_ID, reason: "cleanup" }],
  ),
  wsSuccessCase(
    "runs `memory forget` via @tyrum/client WS",
    wsMemoryForgetSpy,
    { v: 1, deleted_count: 1, tombstones: [] },
    ["memory", "forget", "--selectors", JSON.stringify(MEMORY_SELECTORS), "--confirm", "FORGET"],
    [{ v: 1, confirm: "FORGET", selectors: MEMORY_SELECTORS }],
  ),
  wsSuccessCase(
    "runs `memory export` via @tyrum/client WS",
    wsMemoryExportSpy,
    { v: 1, artifact_id: "art_1" },
    ["memory", "export", "--include-tombstones"],
    [{ v: 1, include_tombstones: true }],
  ),
  wsSuccessCase(
    "passes filter to `memory export` via @tyrum/client WS",
    wsMemoryExportSpy,
    { v: 1, artifact_id: "art_1" },
    ["memory", "export", "--filter", JSON.stringify({ tags: ["t"] })],
    [{ v: 1, filter: { tags: ["t"] }, include_tombstones: false }],
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
    "rejects `memory search` with invalid --filter JSON",
    wsMemorySearchSpy,
    { v: 1, hits: [] },
    ["memory", "search", "--query", "hello", "--filter", "{nope"],
    true,
  ),
  failureCase(
    "rejects `memory forget` when --confirm is missing",
    wsMemoryForgetSpy,
    { v: 1, deleted_count: 1, tombstones: [] },
    ["memory", "forget", "--selectors", JSON.stringify(MEMORY_SELECTORS)],
    true,
  ),
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
