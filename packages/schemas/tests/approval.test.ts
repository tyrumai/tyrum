import { describe, expect, it } from "vitest";
import {
  Approval,
  ApprovalKind,
  ApprovalListRequest,
  ApprovalResolveRequest,
  ApprovalStatus,
} from "../src/index.js";

describe("Approval contracts", () => {
  it("parses an approval record", () => {
    const approval = Approval.parse({
      approval_id: 1,
      kind: "workflow_step",
      status: "pending",
      prompt: "Approve deployment?",
      context: { env: "prod" },
      scope: {
        key: "agent:agent-1:main",
        lane: "main",
        run_id: "run-123",
        step_index: 2,
      },
      created_at: "2026-02-19T12:00:00Z",
      expires_at: null,
      resolution: null,
    });

    expect(approval.kind).toBe("workflow_step");
    expect(approval.status).toBe("pending");
  });

  it("parses approval list request", () => {
    const req = ApprovalListRequest.parse({
      status: "pending",
      limit: 50,
    });
    expect(req.limit).toBe(50);
  });

  it("parses approval resolve request", () => {
    const req = ApprovalResolveRequest.parse({
      approval_id: 123,
      decision: "approved",
      reason: "ok",
    });
    expect(req.decision).toBe("approved");
  });

  it("exports stable enums", () => {
    expect(ApprovalStatus.options).toContain("pending");
    expect(ApprovalKind.options).toContain("workflow_step");
  });
});
