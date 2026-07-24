import { expect, it } from "vitest";
import type { AgentTurnResponse, TyrumUIMessage } from "@tyrum/contracts";
import type { ApprovalRow } from "../../src/modules/approval/dal.js";
import type { UiMessageChunk } from "../../src/modules/harness/translation.js";
import { coerceRecord } from "../../src/modules/util/coerce.js";
import {
  CONFORMANCE_REQUEST,
  createConformanceWorld,
  findToolPart,
  hasToolPart,
  readTranscript,
  resolveApprovalAsOperator,
  settle,
  unwrap,
  waitForPendingApproval,
  type ConformanceAction,
  type ConformanceWorld,
  type ExecutionBackendConformanceFixture,
  type ScriptedExecutionBackend,
} from "./execution-backend-conformance.fixtures.js";

/**
 * Criteria 3 and 6: the durable approval boundary and the tool surface.
 *
 * Both criteria hinge on the same invariant — Tyrum policy is the only source of
 * capability posture — seen from two sides: what blocks (the ask channel) and
 * what is recorded regardless (the observation tap).
 */

const SHELL_COMMAND = "echo hello";
const SHELL_OUTPUT = "hello";
const DENY_REASON = "not on a production checkout";

/** Gates reads by match target as well as the shell, so nothing may be projected. */
const READ_GATING_BUNDLE = {
  v: 1,
  tools: { allow: [], require_approval: ["read:**", "bash"], deny: [] },
};

interface GatedShellRun {
  readonly scripted: ScriptedExecutionBackend;
  readonly chunks: readonly UiMessageChunk[];
  /** The durable approval the harness parked on, before it was resolved. */
  readonly pending: ApprovalRow;
  /** Tools the harness had executed while the approval was still unresolved. */
  readonly executedWhilePending: readonly string[];
  readonly resolved: ApprovalRow;
  readonly response: AgentTurnResponse;
  readonly messages: readonly TyrumUIMessage[];
}

/**
 * Runs one turn whose shell call must be gated, resolves the approval the way an
 * operator would, and hands the whole trace to the caller.
 *
 * The turn is deliberately left unawaited between creation and resolution: that
 * gap is the only place "the call had not executed yet" can be observed.
 */
async function withGatedShellTurn(
  input: {
    fixture: ExecutionBackendConformanceFixture;
    decision: "approved" | "denied";
    reason?: string;
    lead?: readonly ConformanceAction[];
  },
  body: (run: GatedShellRun) => Promise<void>,
): Promise<void> {
  const world = await createConformanceWorld({ approvalWaitMs: 2_000 });
  const chunks: UiMessageChunk[] = [];
  const scripted = input.fixture.createScriptedBackend({
    services: world.services,
    sink: { emitChunk: (chunk) => void chunks.push(chunk) },
    script: [
      {
        sessionRef: "session-a",
        actions: [
          ...(input.lead ?? []),
          { kind: "shell", command: SHELL_COMMAND, output: SHELL_OUTPUT },
          { kind: "text", text: "That is all." },
        ],
      },
    ],
  });

  const running = settle(scripted.backend.executeTurn(CONFORMANCE_REQUEST));
  try {
    const pending = await waitForPendingApproval(world.services);
    const executedWhilePending = [...scripted.executed];
    const resolved = await resolveApprovalAsOperator({
      services: world.services,
      approvalId: pending.approval_id,
      decision: input.decision,
      reason: input.reason,
    });
    const response = await unwrap(running);
    await body({
      scripted,
      chunks,
      pending,
      executedWhilePending,
      resolved,
      response,
      messages: await readTranscript(world),
    });
  } finally {
    // The turn owns a poll loop over the database; never close underneath it.
    await running;
    await world.close();
  }
}

export function describeApprovalCriteria(fixture: ExecutionBackendConformanceFixture): void {
  const shell = fixture.toolNames.shell;
  const readFile = fixture.toolNames.readFile;

  it("criterion 3: pauses a gated call on a durable approval and resumes when approved", async () => {
    await withGatedShellTurn({ fixture, decision: "approved" }, async (run) => {
      // A real approval row, created through the one approval engine Tyrum has.
      expect(run.pending.kind).toBe("workflow_step");
      expect(["queued", "awaiting_human"]).toContain(run.pending.status);
      expect(coerceRecord(run.pending.context)).toMatchObject({
        source: "harness-tool-execution",
        backend_id: fixture.backendId,
        harness_tool_name: shell,
        // The mapping table must land the harness shell tool on Tyrum's `bash`,
        // or the `require_approval: ["bash"]` rule could not have gated it.
        tool_id: "bash",
      });

      // Paused: the harness had not run the command while the approval was open.
      expect(run.executedWhilePending).toEqual([]);

      expect(run.resolved.status).toBe("approved");
      expect(run.scripted.permissions).toEqual([{ toolName: shell, allowed: true }]);
      expect(run.scripted.executed).toEqual([shell]);
      expect(run.response.used_tools).toContain(shell);
      expect(findToolPart(run.messages, shell)).toMatchObject({
        state: "output-available",
        output: SHELL_OUTPUT,
        approval: { id: run.pending.approval_id, approved: true },
      });
    });
  });

  it("criterion 3: propagates an operator denial back to the model", async () => {
    await withGatedShellTurn({ fixture, decision: "denied", reason: DENY_REASON }, async (run) => {
      expect(run.resolved.status).toBe("denied");
      // The denial reaches the harness as a message, which is what the model
      // sees and reacts to.
      expect(run.scripted.permissions).toEqual([
        { toolName: shell, allowed: false, message: DENY_REASON },
      ]);
      expect(run.scripted.executed).toEqual([]);

      expect(run.chunks.map((chunk) => chunk.type)).toContain("tool-approval-request");
      expect(run.chunks.map((chunk) => chunk.type)).toContain("tool-output-denied");
      expect(findToolPart(run.messages, shell)).toMatchObject({
        state: "output-denied",
        errorText: DENY_REASON,
        approval: { id: run.pending.approval_id, approved: false },
      });
    });
  });

  it("criterion 6: pre-authorizes nothing, so policy alone decides every call", async () => {
    const permissive = await runReadOnlyTurn(fixture);
    try {
      // A harness-native allow entry is matched on tool *identity*: the call
      // never reaches the permission callback, so Tyrum would see neither its
      // arguments nor its path. Nothing may be listed there, under any bundle.
      expect(permissive.scripted.sessions[0]?.autoAllowedTools).toEqual([]);
      // The adapter imposes no tool list of its own either: a call policy does
      // not gate still runs, decided by the ask channel rather than by a filter.
      expect(permissive.scripted.permissions).toEqual([{ toolName: readFile, allowed: true }]);
      expect(permissive.scripted.executed).toEqual([readFile]);
    } finally {
      await permissive.world.close();
    }

    const gated = await runReadOnlyTurn(fixture, READ_GATING_BUNDLE);
    try {
      expect(gated.scripted.sessions[0]?.autoAllowedTools).toEqual([]);
      expect(gated.scripted.permissions).toEqual([{ toolName: readFile, allowed: true }]);
      expect(gated.scripted.executed).toEqual([readFile]);
      expect(hasToolPart(await readTranscript(gated.world), readFile)).toBe(true);
    } finally {
      await gated.world.close();
    }
  });

  it("criterion 6: records an allowed read-only call that needed no approval", async () => {
    const run = await runReadOnlyTurn(fixture);
    try {
      // Allowed without a human in the loop: no approval row exists, so the
      // observation tap is the only thing that can record the call.
      expect(
        await run.world.services.approvalDal.getPending({ tenantId: run.world.services.tenantId }),
      ).toEqual([]);
      expect(run.scripted.executed).toEqual([readFile]);
      expect(findToolPart(await readTranscript(run.world), readFile)).toMatchObject({
        state: "output-available",
        output: "file contents",
      });
    } finally {
      await run.world.close();
    }
  });

  it("criterion 6: refuses a read outside the workspace the way the native path does", async () => {
    const world = await createConformanceWorld();
    try {
      const scripted = fixture.createScriptedBackend({
        services: world.services,
        sink: { emitChunk: () => {} },
        script: [
          {
            sessionRef: "session-a",
            actions: [
              { kind: "read_file", path: "/etc/passwd", output: "root:x:0:0" },
              { kind: "text", text: "Tried." },
            ],
          },
        ],
      });

      await scripted.backend.executeTurn(CONFORMANCE_REQUEST);

      // `ToolExecutor.assertSandboxed` throws for this path natively; a flagged
      // conversation must not be able to read what an unflagged one cannot.
      expect(scripted.executed).toEqual([]);
      expect(scripted.permissions[0]?.allowed).toBe(false);
      expect(scripted.permissions[0]?.message).toContain("path escapes workspace");
      expect(findToolPart(await readTranscript(world), readFile)).toMatchObject({
        state: "output-denied",
      });
    } finally {
      await world.close();
    }
  });

  it("criterion 6: runs a gated call only after its approval resolves", async () => {
    await withGatedShellTurn(
      {
        fixture,
        decision: "approved",
        lead: [{ kind: "read_file", path: "README.md", output: "file contents" }],
      },
      async (run) => {
        // The ungated read had already run; the gated shell had not.
        expect(run.executedWhilePending).toEqual([readFile]);
        expect(run.scripted.executed).toEqual([readFile, shell]);
        // Both calls were evaluated, but only the gated one parked on a human.
        expect(run.scripted.permissions).toEqual([
          { toolName: readFile, allowed: true },
          { toolName: shell, allowed: true },
        ]);
        expect(coerceRecord(run.pending.context)?.["harness_tool_name"]).toBe(shell);
        expect(hasToolPart(run.messages, readFile)).toBe(true);
        expect(hasToolPart(run.messages, shell)).toBe(true);
      },
    );
  });

  it("criterion 6: a denied call never executes and its refusal is durable", async () => {
    await withGatedShellTurn({ fixture, decision: "denied", reason: DENY_REASON }, async (run) => {
      expect(run.scripted.executed).toEqual([]);
      expect(run.scripted.permissions[0]?.message).toBe(DENY_REASON);
      expect(findToolPart(run.messages, shell)).toMatchObject({ state: "output-denied" });
    });
  });
}

/** One turn whose only tool call is a read the default policy cannot gate. */
async function runReadOnlyTurn(
  fixture: ExecutionBackendConformanceFixture,
  bundle?: unknown,
): Promise<{ world: ConformanceWorld; scripted: ScriptedExecutionBackend }> {
  const world = await createConformanceWorld(bundle ? { bundle } : undefined);
  try {
    const scripted = fixture.createScriptedBackend({
      services: world.services,
      sink: { emitChunk: () => {} },
      script: [
        {
          sessionRef: "session-a",
          actions: [
            { kind: "read_file", path: "README.md", output: "file contents" },
            { kind: "text", text: "Read it." },
          ],
        },
      ],
    });
    await scripted.backend.executeTurn(CONFORMANCE_REQUEST);
    return { world, scripted };
  } catch (err) {
    await world.close();
    throw err;
  }
}
