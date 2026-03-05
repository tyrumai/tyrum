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
    approval_id: "550e8400-e29b-41d4-a716-446655440000",
    approval_key: "approval-1",
    kind: "workflow_step",
    status: "pending",
    prompt: "Approve deployment?",
    context: { env: "prod" },
    scope: {
      key: "agent:agent-1:main",
      lane: "main",
      run_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
      step_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
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
    expectRejects(Approval, { ...baseApproval, approval_id: 1 });
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
      approval_id: "550e8400-e29b-41d4-a716-446655440001",
      decision: "approved",
      reason: "ok",
    });
    expect(req.decision).toBe("approved");
  });

  it("rejects approval resolve request with invalid decision", () => {
    expectRejects(ApprovalResolveRequest, {
      approval_id: "550e8400-e29b-41d4-a716-446655440001",
      decision: "maybe",
    });
  });

  it("rejects approval resolve request missing approval_id", () => {
    const bad = { decision: "approved" } as const;
    expectRejects(ApprovalResolveRequest, bad);
  });

  it("exports stable enums", () => {
    expect(ApprovalStatus.options).toContain("pending");
    expect(ApprovalKind.options).toContain("workflow_step");
    expect(ApprovalKind.options).toContain("intent");
    expect(ApprovalKind.options).toContain("retry");
    expect(ApprovalKind.options).toContain("budget");
    expect(ApprovalKind.options).toContain("policy");
    expect(ApprovalKind.options).toContain("connector.send");
  });
});
