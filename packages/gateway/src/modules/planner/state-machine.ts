/**
 * Plan state machine — port of services/planner/src/state_machine.rs
 *
 * Pure finite-state machine tracking plan lifecycle through policy review,
 * step execution, human confirmation, and postcondition verification.
 */

// ---------------------------------------------------------------------------
// Failure reasons
// ---------------------------------------------------------------------------

export type PlanFailureReason =
  | "policy_denied"
  | "user_declined"
  | "postcondition_failed"
  | "executor_failed"
  | "cancelled";

// ---------------------------------------------------------------------------
// Plan status — discriminated union on `kind`
// ---------------------------------------------------------------------------

export type PlanStatus =
  | { kind: "draft" }
  | { kind: "awaiting_policy_review" }
  | { kind: "ready"; nextStepIndex: number }
  | { kind: "awaiting_human_confirmation"; stepIndex: number }
  | { kind: "awaiting_postcondition"; stepIndex: number }
  | {
      kind: "succeeded";
      completedAt: string;
      stepsExecuted: number;
    }
  | {
      kind: "failed";
      occurredAt: string;
      stepIndex: number | undefined;
      reason: PlanFailureReason;
      detail: string | undefined;
    };

// ---------------------------------------------------------------------------
// Plan events — discriminated union on `kind`
// ---------------------------------------------------------------------------

export type PlanEvent =
  | { kind: "submitted_for_policy" }
  | { kind: "policy_approved" }
  | { kind: "policy_denied"; detail: string }
  | { kind: "step_dispatched"; stepIndex: number }
  | { kind: "requires_human_confirmation"; stepIndex: number }
  | { kind: "human_approved"; stepIndex: number }
  | { kind: "human_rejected"; stepIndex: number; detail?: string }
  | { kind: "postcondition_satisfied"; stepIndex: number }
  | { kind: "postcondition_failed"; stepIndex: number; detail: string }
  | { kind: "executor_failed"; stepIndex: number; detail: string }
  | { kind: "cancelled"; detail?: string };

// ---------------------------------------------------------------------------
// Transition error
// ---------------------------------------------------------------------------

export class PlanTransitionError extends Error {
  constructor(
    public readonly state: PlanStatus,
    public readonly event: PlanEvent,
  ) {
    super(`event ${event.kind} is invalid while plan state is ${state.kind}`);
    this.name = "PlanTransitionError";
  }
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export class PlanStateMachine {
  private totalSteps: number;
  private executedSteps: number;
  private _status: PlanStatus;

  constructor(totalSteps: number) {
    this.totalSteps = totalSteps;
    this.executedSteps = 0;
    this._status = { kind: "draft" };
  }

  get status(): PlanStatus {
    return this._status;
  }

  apply(event: PlanEvent): PlanStatus {
    const s = this._status;
    const now = new Date().toISOString();

    switch (s.kind) {
      case "draft": {
        if (event.kind === "submitted_for_policy") {
          this._status = { kind: "awaiting_policy_review" };
          return this._status;
        }
        break;
      }

      case "awaiting_policy_review": {
        if (event.kind === "policy_approved") {
          if (this.totalSteps === 0) {
            this._status = {
              kind: "succeeded",
              completedAt: now,
              stepsExecuted: 0,
            };
          } else {
            this._status = {
              kind: "ready",
              nextStepIndex: this.executedSteps,
            };
          }
          return this._status;
        }
        if (event.kind === "policy_denied") {
          this._status = {
            kind: "failed",
            occurredAt: now,
            stepIndex: undefined,
            reason: "policy_denied",
            detail: event.detail,
          };
          return this._status;
        }
        break;
      }

      case "ready": {
        if (event.kind === "step_dispatched" && event.stepIndex === s.nextStepIndex) {
          this._status = {
            kind: "awaiting_postcondition",
            stepIndex: event.stepIndex,
          };
          return this._status;
        }
        if (event.kind === "requires_human_confirmation" && event.stepIndex === s.nextStepIndex) {
          this._status = {
            kind: "awaiting_human_confirmation",
            stepIndex: event.stepIndex,
          };
          return this._status;
        }
        if (event.kind === "cancelled") {
          this._status = {
            kind: "failed",
            occurredAt: now,
            stepIndex: undefined,
            reason: "cancelled",
            detail: event.detail,
          };
          return this._status;
        }
        break;
      }

      case "awaiting_human_confirmation": {
        if (event.kind === "human_approved" && event.stepIndex === s.stepIndex) {
          this.executedSteps += 1;
          this.advanceOrComplete();
          return this._status;
        }
        if (event.kind === "human_rejected" && event.stepIndex === s.stepIndex) {
          this._status = {
            kind: "failed",
            occurredAt: now,
            stepIndex: s.stepIndex,
            reason: "user_declined",
            detail: event.detail,
          };
          return this._status;
        }
        if (event.kind === "cancelled") {
          this._status = {
            kind: "failed",
            occurredAt: now,
            stepIndex: s.stepIndex,
            reason: "cancelled",
            detail: event.detail,
          };
          return this._status;
        }
        break;
      }

      case "awaiting_postcondition": {
        if (event.kind === "postcondition_satisfied" && event.stepIndex === s.stepIndex) {
          this.executedSteps += 1;
          this.advanceOrComplete();
          return this._status;
        }
        if (event.kind === "postcondition_failed" && event.stepIndex === s.stepIndex) {
          this._status = {
            kind: "failed",
            occurredAt: now,
            stepIndex: s.stepIndex,
            reason: "postcondition_failed",
            detail: event.detail,
          };
          return this._status;
        }
        if (event.kind === "executor_failed" && event.stepIndex === s.stepIndex) {
          this._status = {
            kind: "failed",
            occurredAt: now,
            stepIndex: s.stepIndex,
            reason: "executor_failed",
            detail: event.detail,
          };
          return this._status;
        }
        if (event.kind === "cancelled") {
          this._status = {
            kind: "failed",
            occurredAt: now,
            stepIndex: s.stepIndex,
            reason: "cancelled",
            detail: event.detail,
          };
          return this._status;
        }
        break;
      }

      case "succeeded":
      case "failed":
        break;
    }

    throw new PlanTransitionError(s, event);
  }

  private advanceOrComplete(): void {
    if (this.executedSteps >= this.totalSteps) {
      this._status = {
        kind: "succeeded",
        completedAt: new Date().toISOString(),
        stepsExecuted: this.executedSteps,
      };
    } else {
      this._status = {
        kind: "ready",
        nextStepIndex: this.executedSteps,
      };
    }
  }
}
