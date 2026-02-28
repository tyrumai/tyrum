import { describe, expect, it } from "vitest";
import {
  Approval,
  ApprovalKind,
  ApprovalListRequest,
  ApprovalResolveRequest,
  ApprovalStatus,
} from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("Approval contracts", () => {
  const baseApproval = {
    approval_id: 1,
    kind: "workflow_step",
    status: "pending",
    prompt: "Approve deployment?",
    context: { env: "prod" },
    scope: {
      key: "agent:agent-1:telegram-1:main",
      lane: "main",
      run_id: "run-123",
      step_index: 2,
    },
    created_at: "2026-02-19T12:00:00Z",
    expires_at: null,
    resolution: null,
  } as const;

  it("parses an approval record", () => {
    const approval = Approval.parse(baseApproval);

    expect(approval.kind).toBe("workflow_step");
    expect(approval.status).toBe("pending");
  });

  it("rejects an approval record with wrong approval_id type", () => {
    expectRejects(Approval, { ...baseApproval, approval_id: "1" });
  });

  it("rejects an approval record missing created_at", () => {
    const bad = { ...baseApproval } as Record<string, unknown>;
    delete bad.created_at;
    expectRejects(Approval, bad);
  });

  it("rejects pending approvals with non-null resolution", () => {
    expectRejects(Approval, {
      ...baseApproval,
      resolution: { decision: "approved", resolved_at: "2026-02-19T12:00:00Z" },
    });
  });

  it("rejects non-pending approvals with resolution: null", () => {
    expectRejects(Approval, { ...baseApproval, status: "approved" });
  });

  it("parses approval list request", () => {
    const req = ApprovalListRequest.parse({
      status: "pending",
      limit: 50,
    });
    expect(req.limit).toBe(50);
  });

  it("rejects approval list request with invalid status", () => {
    expectRejects(ApprovalListRequest, { status: "nope", limit: 50 });
  });

  it("rejects approval list request with non-integer limit", () => {
    expectRejects(ApprovalListRequest, { status: "pending", limit: "50" });
  });

  it("parses approval resolve request", () => {
    const req = ApprovalResolveRequest.parse({
      approval_id: 123,
      decision: "approved",
      reason: "ok",
    });
    expect(req.decision).toBe("approved");
  });

  it("rejects approval resolve request with invalid decision", () => {
    expectRejects(ApprovalResolveRequest, { approval_id: 123, decision: "maybe" });
  });

  it("rejects approval resolve request missing approval_id", () => {
    const bad = { decision: "approved" } as const;
    expectRejects(ApprovalResolveRequest, bad);
  });

  it("exports stable enums", () => {
    expect(ApprovalStatus.options).toContain("pending");
    expect(ApprovalKind.options).toContain("workflow_step");
    expect(ApprovalKind.options).toContain("budget");
    expect(ApprovalKind.options).toContain("policy");
  });
});
