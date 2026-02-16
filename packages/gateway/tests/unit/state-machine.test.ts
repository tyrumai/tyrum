/**
 * Plan state machine tests — port of services/planner/src/state_machine.rs tests
 */

import { describe, expect, it } from "vitest";
import {
  PlanStateMachine,
  PlanTransitionError,
} from "../../src/modules/planner/state-machine.js";

describe("PlanStateMachine", () => {
  it("happy_path_through_execution", () => {
    const machine = new PlanStateMachine(2);

    machine.apply({ kind: "submitted_for_policy" });
    machine.apply({ kind: "policy_approved" });
    expect(machine.status).toEqual({ kind: "ready", nextStepIndex: 0 });

    machine.apply({ kind: "step_dispatched", stepIndex: 0 });
    expect(machine.status).toEqual({
      kind: "awaiting_postcondition",
      stepIndex: 0,
    });

    machine.apply({ kind: "postcondition_satisfied", stepIndex: 0 });
    expect(machine.status).toEqual({ kind: "ready", nextStepIndex: 1 });

    machine.apply({ kind: "requires_human_confirmation", stepIndex: 1 });
    machine.apply({ kind: "human_approved", stepIndex: 1 });

    const status = machine.status;
    expect(status.kind).toBe("succeeded");
    if (status.kind === "succeeded") {
      expect(status.stepsExecuted).toBe(2);
    }
  });

  it("policy_denial_failure", () => {
    const machine = new PlanStateMachine(1);
    machine.apply({ kind: "submitted_for_policy" });
    machine.apply({ kind: "policy_denied", detail: "missing consent" });

    const status = machine.status;
    expect(status.kind).toBe("failed");
    if (status.kind === "failed") {
      expect(status.reason).toBe("policy_denied");
      expect(status.detail).toBe("missing consent");
      expect(status.stepIndex).toBeUndefined();
    }
  });

  it("invalid_transition_returns_error", () => {
    const machine = new PlanStateMachine(1);
    expect(() => {
      machine.apply({ kind: "policy_approved" });
    }).toThrow(PlanTransitionError);

    try {
      const m = new PlanStateMachine(1);
      m.apply({ kind: "policy_approved" });
    } catch (err) {
      expect(err).toBeInstanceOf(PlanTransitionError);
      if (err instanceof PlanTransitionError) {
        expect(err.state.kind).toBe("draft");
        expect(err.event.kind).toBe("policy_approved");
      }
    }
  });

  it("cancellation_preserves_active_step_index", () => {
    const machine = new PlanStateMachine(1);
    machine.apply({ kind: "submitted_for_policy" });
    machine.apply({ kind: "policy_approved" });
    machine.apply({ kind: "step_dispatched", stepIndex: 0 });

    machine.apply({ kind: "cancelled", detail: "user stopped" });

    const status = machine.status;
    expect(status.kind).toBe("failed");
    if (status.kind === "failed") {
      expect(status.stepIndex).toBe(0);
      expect(status.detail).toBe("user stopped");
      expect(status.reason).toBe("cancelled");
    }
  });

  it("cancellation_from_ready_has_no_step_index", () => {
    const machine = new PlanStateMachine(2);
    machine.apply({ kind: "submitted_for_policy" });
    machine.apply({ kind: "policy_approved" });

    machine.apply({ kind: "cancelled" });

    const status = machine.status;
    expect(status.kind).toBe("failed");
    if (status.kind === "failed") {
      expect(status.stepIndex).toBeUndefined();
      expect(status.reason).toBe("cancelled");
    }
  });

  it("executor_failure_propagation", () => {
    const machine = new PlanStateMachine(1);
    machine.apply({ kind: "submitted_for_policy" });
    machine.apply({ kind: "policy_approved" });
    machine.apply({ kind: "step_dispatched", stepIndex: 0 });

    machine.apply({
      kind: "executor_failed",
      stepIndex: 0,
      detail: "playwright crashed",
    });

    const status = machine.status;
    expect(status.kind).toBe("failed");
    if (status.kind === "failed") {
      expect(status.reason).toBe("executor_failed");
      expect(status.stepIndex).toBe(0);
      expect(status.detail).toBe("playwright crashed");
    }
  });
});
