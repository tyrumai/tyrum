import { describe, it } from "vitest";
import {
  NativeExecutionBackend,
  type ExecutionBackend,
} from "../../src/modules/agent/execution-backend.js";

export interface ExecutionBackendConformanceFixture {
  readonly backend: ExecutionBackend;
}

export function describeExecutionBackendConformance(
  fixture: ExecutionBackendConformanceFixture,
): void {
  describe(`${fixture.backend.id} execution backend conformance`, () => {
    it.todo("persists a text-turn reply in the Tyrum transcript");
    it.todo("streams partial output and tool activity through chat.ui-message.stream");
    it.todo("pauses for durable approval and propagates approval or denial");
    it.todo("retains full transcript history without harness session files");
    it.todo("resumes a harness session and recovers from Tyrum conversation state");
    it.todo("exposes the full tool surface with approval and observation coverage");
  });
}

const notRunBySkeleton = async (): Promise<never> => {
  throw new Error("native conformance execution is outside TYR-7 scope");
};

describeExecutionBackendConformance({
  backend: new NativeExecutionBackend({
    executeTurn: notRunBySkeleton,
    executeTurnStream: notRunBySkeleton,
  }),
});
