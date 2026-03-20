import { vi } from "vitest";
import type {
  SubagentDescriptor,
  WorkClarification,
  WorkItem,
  WorkItemTask,
  WorkScope,
} from "@tyrum/contracts";
import type { WorkboardLogger } from "../src/index.js";

export const TEST_SCOPE = {
  tenant_id: "tenant-1",
  agent_id: "agent-1",
  workspace_id: "workspace-1",
} satisfies WorkScope;

const DEFAULT_TIMESTAMP = "2026-03-19T00:00:00.000Z";

export function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    work_item_id: "work-1",
    tenant_id: TEST_SCOPE.tenant_id,
    agent_id: TEST_SCOPE.agent_id,
    workspace_id: TEST_SCOPE.workspace_id,
    kind: "action",
    title: "Ship runtime split",
    status: "backlog",
    priority: 1,
    created_at: DEFAULT_TIMESTAMP,
    created_from_session_key: "agent:default:main",
    last_active_at: null,
    updated_at: DEFAULT_TIMESTAMP,
    ...overrides,
  };
}

export function makeTask(overrides: Partial<WorkItemTask> = {}): WorkItemTask {
  return {
    task_id: "task-1",
    work_item_id: "work-1",
    status: "queued",
    depends_on: [],
    execution_profile: "planner",
    side_effect_class: "workspace",
    artifacts: [],
    started_at: null,
    finished_at: null,
    result_summary: "Task summary",
    ...overrides,
  };
}

export function makeSubagent(overrides: Partial<SubagentDescriptor> = {}): SubagentDescriptor {
  return {
    subagent_id: "subagent-1",
    tenant_id: TEST_SCOPE.tenant_id,
    agent_id: TEST_SCOPE.agent_id,
    workspace_id: TEST_SCOPE.workspace_id,
    execution_profile: "planner",
    session_key: "agent:default:subagent:subagent-1",
    lane: "subagent",
    status: "paused",
    created_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
    last_heartbeat_at: null,
    closed_at: null,
    ...overrides,
  };
}

export function makeClarification(overrides: Partial<WorkClarification> = {}): WorkClarification {
  return {
    clarification_id: "clarification-1",
    tenant_id: TEST_SCOPE.tenant_id,
    agent_id: TEST_SCOPE.agent_id,
    workspace_id: TEST_SCOPE.workspace_id,
    work_item_id: "work-1",
    status: "open",
    question: "Need more detail?",
    requested_for_session_key: "agent:default:main",
    requested_at: DEFAULT_TIMESTAMP,
    updated_at: DEFAULT_TIMESTAMP,
    answered_at: null,
    ...overrides,
  };
}

export function createLogger(): WorkboardLogger & {
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  return {
    warn: vi.fn(),
    error: vi.fn(),
  };
}
