import { describe, it } from "vitest";
import { describeApprovalCriteria } from "./execution-backend-conformance.criteria-approval.js";
import { describeTranscriptCriteria } from "./execution-backend-conformance.criteria-transcript.js";
import type { ExecutionBackendConformanceFixture } from "./execution-backend-conformance.fixtures.js";

/**
 * The shared execution-backend conformance suite (ARCH-22).
 *
 * `docs/architecture/reference/execution-backend-conformance.md` defines six
 * criteria every backend must satisfy at the Tyrum execution port. This module
 * runs all six against a fixture, so TYR-9 (OpenCode) and TYR-10 (Codex) get the
 * criteria for free and only supply their own adapter plus a scripted harness
 * session.
 *
 * Everything Tyrum owns is real: a migrated SQLite database, `ConversationDal`,
 * `PolicyService`, `ApprovalDal` and the operator approval path. Only the harness
 * itself is scripted, so no test needs an API key, a network, or a subprocess.
 */

export type {
  ConformanceAction,
  ConformancePermission,
  ConformanceServices,
  ConformanceSessionObservation,
  ConformanceTurnScript,
  ConformanceWorld,
  ExecutionBackendConformanceFixture,
  ScriptedExecutionBackend,
} from "./execution-backend-conformance.fixtures.js";

export function describeExecutionBackendConformance(
  fixture: ExecutionBackendConformanceFixture,
): void {
  describe(`${fixture.backendId} execution backend conformance`, () => {
    describeTranscriptCriteria(fixture);
    describeApprovalCriteria(fixture);
  });
}

/**
 * The native backend's conformance gap, stated rather than implied.
 *
 * `native` is not a harness: it is Tyrum's own turn loop, and driving it through
 * these criteria needs a model provider and the whole native tool stack rather
 * than a scripted session. ARCH-22 scopes the shared suite to harness backends
 * (TYR-7 introduced the port, TYR-8 the first adapter), so native conformance is
 * deliberately not asserted here — the criteria below are a visible debt, not a
 * silently skipped fixture.
 */
export function describeNativeExecutionBackendConformanceGap(): void {
  describe("native execution backend conformance (deliberately unasserted)", () => {
    it.todo("criterion 1: persists a text-turn reply in the Tyrum transcript");
    it.todo("criterion 2: streams partial output and tool activity");
    it.todo("criterion 3: pauses for durable approval and propagates approval or denial");
    it.todo("criterion 4: retains full transcript history without harness session state");
    it.todo("criterion 5: continues the same execution context on a second message");
    it.todo("criterion 6: gates state-changing calls and records auto-allowed ones");
  });
}
