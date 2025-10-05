import { NextResponse } from "next/server";

type AccountAction = "export" | "delete";

type AuditTaskStub = {
  id: string;
  type: string;
  auditReference: string;
  etaSeconds: number;
  enqueuedAt: string;
};

const AUDIT_TASKS: Record<AccountAction, AuditTaskStub> = {
  export: {
    id: "export-task-stub",
    type: "account_export",
    auditReference: "AUDIT-EXPORT-0001",
    etaSeconds: 120,
    enqueuedAt: "2025-01-15T11:00:00.000Z",
  },
  delete: {
    id: "delete-task-stub",
    type: "account_delete",
    auditReference: "AUDIT-DELETE-0001",
    etaSeconds: 43200,
    enqueuedAt: "2025-01-16T08:00:00.000Z",
  },
};

export function buildAuditTaskResponse(action: AccountAction) {
  const task = AUDIT_TASKS[action];
  return NextResponse.json(
    {
      status: "enqueued",
      task,
    },
    { status: 202 },
  );
}
