import { expect, it } from "vitest";
import { ConversationState, type TyrumUIMessage } from "@tyrum/contracts";
import type { UiMessageChunk } from "../../src/modules/harness/translation.js";
import { coerceRecord } from "../../src/modules/util/coerce.js";
import {
  CONFORMANCE_PROMPT,
  CONFORMANCE_REQUEST,
  createConformanceWorld,
  findToolPart,
  readTranscript,
  type ConformanceWorld,
  type ExecutionBackendConformanceFixture,
} from "./execution-backend-conformance.fixtures.js";

/**
 * Criteria 1, 2, 4 and 5: the durable transcript, the live stream, and harness
 * continuity as a cache rather than a source of truth.
 */

/** History a harness turn must extend, never replace. */
const PRIOR_HISTORY: TyrumUIMessage[] = [
  { id: "prior-user", role: "user", parts: [{ type: "text", text: "hello" }] },
  { id: "prior-assistant", role: "assistant", parts: [{ type: "text", text: "hi" }] },
];

const CHECKPOINT_GOAL = "ship the ARCH-22 harness pivot";
const CHECKPOINT_HANDOFF = "the adapter is wired; conformance is the last gate";

function collect(chunks: UiMessageChunk[]): { emitChunk: (chunk: UiMessageChunk) => void } {
  return { emitChunk: (chunk) => void chunks.push(chunk) };
}

/** The port types its stream as `unknown`; parse it rather than assume it. */
function asUiMessageChunk(value: unknown): UiMessageChunk {
  const record = coerceRecord(value);
  const type = record?.["type"];
  if (!record || typeof type !== "string") {
    throw new Error(`the turn stream produced a value that is not a UI message chunk`);
  }
  return { ...record, type };
}

export function describeTranscriptCriteria(fixture: ExecutionBackendConformanceFixture): void {
  it("criterion 1: persists a text-turn reply in the Tyrum transcript", async () => {
    const world = await createConformanceWorld();
    try {
      const scripted = fixture.createScriptedBackend({
        services: world.services,
        sink: collect([]),
        script: [
          { sessionRef: "session-a", actions: [{ kind: "text", text: "The tree is clean." }] },
        ],
      });

      const response = await scripted.backend.executeTurn(CONFORMANCE_REQUEST);

      // The backend must land on Tyrum's conversation, not one of its own.
      expect(response.conversation_id).toBe(world.conversation.conversation_id);
      expect(response.conversation_key).toBe(world.conversation.conversation_key);
      expect(response.reply).toBe("The tree is clean.");

      const messages = await readTranscript(world);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        role: "user",
        parts: [{ type: "text", text: CONFORMANCE_PROMPT }],
      });
      expect(messages[1]).toMatchObject({
        role: "assistant",
        parts: [{ type: "text", text: "The tree is clean." }],
      });
      // Nothing may be left mid-stream once the turn has stopped producing.
      expect(messages[1]?.parts.filter((part) => part["state"] === "streaming")).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it("criterion 2: streams partial output and tool activity on chat.ui-message.stream", async () => {
    const world = await createConformanceWorld();
    try {
      const scripted = fixture.createScriptedBackend({
        services: world.services,
        // Deliberately a sink that drops everything: the chunks the criterion is
        // about must reach the caller through the port's own streaming handle,
        // which is what the operator UI takes, not through a sink the test
        // hands the adapter.
        sink: collect([]),
        script: [
          {
            sessionRef: "session-a",
            actions: [
              { kind: "text", text: "Looking at the file." },
              { kind: "read_file", path: "README.md", output: "file contents" },
              { kind: "text", text: "Done." },
            ],
          },
        ],
      });

      const handle = await scripted.backend.executeTurnStream(CONFORMANCE_REQUEST);
      const chunks: UiMessageChunk[] = [];
      for await (const chunk of handle.streamResult.toUIMessageStream()) {
        chunks.push(asUiMessageChunk(chunk));
      }
      await handle.finalize();

      expect(chunks.map((chunk) => chunk.type)).toEqual([
        "text-start",
        "text-delta",
        "text-end",
        "tool-input-available",
        "tool-output-available",
        "text-start",
        "text-delta",
        "text-end",
        "finish",
      ]);
      // Partial output, not one terminal blob.
      expect(
        chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk["delta"]),
      ).toEqual(["Looking at the file.", "Done."]);

      const started = chunks.find((chunk) => chunk.type === "tool-input-available");
      const finished = chunks.find((chunk) => chunk.type === "tool-output-available");
      expect(started).toMatchObject({ toolName: fixture.toolNames.readFile });
      expect(Object.values(started?.["input"] ?? {})).toContain("README.md");
      expect(finished).toMatchObject({
        toolCallId: started?.["toolCallId"],
        output: "file contents",
      });
    } finally {
      await world.close();
    }
  });

  it("criterion 4: keeps the full history readable once harness continuity state is gone", async () => {
    const world = await createConformanceWorld();
    try {
      await world.services.conversationDal.replaceMessages({
        tenantId: world.services.tenantId,
        conversationId: world.conversation.conversation_id,
        messages: PRIOR_HISTORY,
      });

      const scripted = fixture.createScriptedBackend({
        services: world.services,
        sink: collect([]),
        script: [
          {
            sessionRef: "session-a",
            actions: [
              { kind: "read_file", path: "docs/plan.md", output: "the plan" },
              { kind: "text", text: "Read the plan." },
            ],
          },
        ],
      });
      await scripted.backend.executeTurn(CONFORMANCE_REQUEST);

      const before = await readTranscript(world);
      expect(before).toHaveLength(4);
      expect(before.slice(0, 2)).toEqual(PRIOR_HISTORY);

      const sessionKey = {
        tenantId: world.services.tenantId,
        conversationId: world.conversation.conversation_id,
        backendId: fixture.backendId,
      };
      // The row must have existed, or "deleting it" would prove nothing.
      expect(await world.services.sessionDal.get(sessionKey)).toMatchObject({
        session_ref: "session-a",
      });
      expect(await world.services.sessionDal.clear(sessionKey)).toBe(true);
      expect(await world.services.sessionDal.get(sessionKey)).toBeUndefined();

      const after = await readTranscript(world);
      expect(after).toEqual(before);
      // Complete, not merely present: the tool evidence survives too.
      expect(findToolPart(after, fixture.toolNames.readFile)).toMatchObject({
        state: "output-available",
        output: "the plan",
      });
    } finally {
      await world.close();
    }
  });

  it("criterion 5: resumes the harness session and recovers from Tyrum conversation state", async () => {
    const world = await createConformanceWorld();
    try {
      const scripted = fixture.createScriptedBackend({
        services: world.services,
        sink: collect([]),
        script: [
          { sessionRef: "session-a", actions: [{ kind: "text", text: "one" }] },
          { sessionRef: "session-a", actions: [{ kind: "text", text: "two" }] },
          { sessionRef: "session-b", actions: [{ kind: "text", text: "three" }] },
        ],
      });

      await scripted.backend.executeTurn(CONFORMANCE_REQUEST);
      await scripted.backend.executeTurn(CONFORMANCE_REQUEST);

      expect(scripted.sessions[0]?.resumeRef).toBeUndefined();
      // Second message continues the same harness execution context.
      expect(scripted.sessions[1]?.resumeRef).toBe("session-a");
    } finally {
      await world.close();
    }
  });

  it("criterion 5: recovers a fresh session from the checkpoint when harness continuity is gone", async () => {
    const world = await createConformanceWorld();
    try {
      const scripted = fixture.createScriptedBackend({
        services: world.services,
        sink: collect([]),
        script: [
          { sessionRef: "session-a", actions: [{ kind: "text", text: "one" }] },
          // The turn after the harness lost its continuity files: Tyrum still
          // holds the ref, the harness refuses it. This is the state the
          // recovery test names, and it is not reachable by deleting Tyrum's
          // own row — that only sends the planner down the first-turn path.
          { sessionRef: "session-b", actions: [], rejectsResume: true },
          { sessionRef: "session-b", actions: [{ kind: "text", text: "recovered" }] },
        ],
      });

      await scripted.backend.executeTurn(CONFORMANCE_REQUEST);
      await seedCheckpoint(world);

      const response = await scripted.backend.executeTurn(CONFORMANCE_REQUEST);

      // The rejected ref must not fail the turn...
      expect(response.reply).toBe("recovered");
      expect(scripted.sessions[1]?.resumeRef).toBe("session-a");
      // ...a fresh session starts instead...
      expect(scripted.sessions[2]?.resumeRef).toBeUndefined();
      // ...seeded from Tyrum's own conversation-state checkpoint...
      expect(scripted.sessions[2]?.systemPromptAppend).toContain(CHECKPOINT_GOAL);
      expect(scripted.sessions[2]?.systemPromptAppend).toContain(CHECKPOINT_HANDOFF);
      // ...and the stale ref is replaced, not left to fail every later turn.
      expect(
        await world.services.sessionDal.get({
          tenantId: world.services.tenantId,
          conversationId: world.conversation.conversation_id,
          backendId: fixture.backendId,
        }),
      ).toMatchObject({ session_ref: "session-b" });
    } finally {
      await world.close();
    }
  });
}

async function seedCheckpoint(world: ConformanceWorld): Promise<void> {
  await world.services.conversationDal.replaceContextState({
    tenantId: world.services.tenantId,
    conversationId: world.conversation.conversation_id,
    contextState: ConversationState.parse({
      version: 1,
      checkpoint: { goal: CHECKPOINT_GOAL, handoff_md: CHECKPOINT_HANDOFF },
      updated_at: world.services.now().toISOString(),
    }),
  });
}
