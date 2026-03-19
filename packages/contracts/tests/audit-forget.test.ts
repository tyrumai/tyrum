import { describe, expect, it } from "vitest";
import * as schemas from "../src/index.js";

describe("Audit forget contracts", () => {
  it("exports AuditForgetRequest and AuditForgetResponse", () => {
    expect((schemas as any).AuditForgetRequest).toBeDefined();
    expect((schemas as any).AuditForgetResponse).toBeDefined();
  });

  it("parses a valid forget request", () => {
    const AuditForgetRequest = (schemas as any).AuditForgetRequest;
    expect(AuditForgetRequest).toBeDefined();

    const parsed = AuditForgetRequest.parse({
      confirm: "FORGET",
      entity_type: "plan",
      entity_id: "plan-1",
      decision: "delete",
    });
    expect(parsed).toMatchObject({ decision: "delete" });
  });

  it("rejects invalid forget request confirm", () => {
    const AuditForgetRequest = (schemas as any).AuditForgetRequest;
    expect(AuditForgetRequest).toBeDefined();

    const parsed = AuditForgetRequest.safeParse({
      confirm: "nope",
      entity_type: "plan",
      entity_id: "plan-1",
      decision: "delete",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects invalid forget request decision", () => {
    const AuditForgetRequest = (schemas as any).AuditForgetRequest;
    expect(AuditForgetRequest).toBeDefined();

    const parsed = AuditForgetRequest.safeParse({
      confirm: "FORGET",
      entity_type: "plan",
      entity_id: "plan-1",
      decision: "explode",
    });
    expect(parsed.success).toBe(false);
  });

  it("parses a valid forget response", () => {
    const AuditForgetResponse = (schemas as any).AuditForgetResponse;
    expect(AuditForgetResponse).toBeDefined();

    const parsed = AuditForgetResponse.parse({
      decision: "retain",
      deleted_count: 0,
      proof_event_id: 123,
    });
    expect(parsed).toMatchObject({ decision: "retain" });
  });
});
