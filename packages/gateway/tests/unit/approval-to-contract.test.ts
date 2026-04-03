import { describe, expect, it } from "vitest";
import type { ApprovalRow } from "../../src/modules/approval/dal.js";
import { toApprovalContract } from "../../src/modules/approval/to-contract.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

describe("toApprovalContract", () => {
  it("omits invalid legacy agent ids instead of dropping the approval", () => {
    const row = {
      tenant_id: DEFAULT_TENANT_ID,
      approval_id: "00000000-0000-4000-8000-0000000000ab",
      approval_key: "approval:legacy-agent",
      agent_id: "legacy-agent",
      workspace_id: DEFAULT_WORKSPACE_ID,
      kind: "policy",
      status: "awaiting_human",
      prompt: "Ok?",
      motivation: "A review is required before continuing.",
      context: {},
      created_at: "2026-02-20T22:00:00.000Z",
      expires_at: null,
      latest_review: null,
      conversation_id: null,
      plan_id: null,
      turn_id: null,
      turn_item_id: null,
      workflow_run_step_id: null,
      step_id: null,
      attempt_id: null,
      work_item_id: null,
      work_item_task_id: null,
      resume_token: null,
    } satisfies ApprovalRow;

    const contract = toApprovalContract(row);

    expect(contract).toBeDefined();
    expect(contract?.approval_id).toBe(row.approval_id);
    expect(contract?.agent_id).toBeUndefined();
  });

  it("keeps valid agent ids in the public contract", () => {
    const row = {
      tenant_id: DEFAULT_TENANT_ID,
      approval_id: "00000000-0000-4000-8000-0000000000ac",
      approval_key: "approval:valid-agent",
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
      kind: "policy",
      status: "awaiting_human",
      prompt: "Ok?",
      motivation: "A review is required before continuing.",
      context: {},
      created_at: "2026-02-20T22:00:00.000Z",
      expires_at: null,
      latest_review: null,
      conversation_id: null,
      plan_id: null,
      turn_id: null,
      turn_item_id: null,
      workflow_run_step_id: null,
      step_id: null,
      attempt_id: null,
      work_item_id: null,
      work_item_task_id: null,
      resume_token: null,
    } satisfies ApprovalRow;

    const contract = toApprovalContract(row);

    expect(contract?.agent_id).toBe(DEFAULT_AGENT_ID);
  });

  it("maps turn-item and workflow-step scope ids into the public contract", () => {
    const row = {
      tenant_id: DEFAULT_TENANT_ID,
      approval_id: "00000000-0000-4000-8000-0000000000ad",
      approval_key: "approval:scope-ids",
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
      kind: "policy",
      status: "awaiting_human",
      prompt: "Ok?",
      motivation: "A review is required before continuing.",
      context: {},
      created_at: "2026-02-20T22:00:00.000Z",
      expires_at: null,
      latest_review: null,
      conversation_id: null,
      plan_id: null,
      turn_id: "00000000-0000-4000-8000-0000000000ae",
      turn_item_id: "00000000-0000-4000-8000-0000000000af",
      workflow_run_step_id: "00000000-0000-4000-8000-0000000000b0",
      step_id: "00000000-0000-4000-8000-0000000000b1",
      attempt_id: "00000000-0000-4000-8000-0000000000b2",
      work_item_id: null,
      work_item_task_id: null,
      resume_token: null,
    } satisfies ApprovalRow;

    const contract = toApprovalContract(row);

    expect(contract?.scope).toEqual({
      turn_id: row.turn_id,
      turn_item_id: row.turn_item_id,
      workflow_run_step_id: row.workflow_run_step_id,
    });
  });
});
