import { afterEach, describe, expect, it, vi } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../../src/modules/desktop-environments/dal.js";
import { DesktopEnvironmentLifecycleService } from "../../src/modules/desktop-environments/lifecycle-service.js";
import { SessionLaneNodeAttachmentDal } from "../../src/modules/agent/session-lane-node-attachment-dal.js";
import { executeSandboxTool } from "../../src/modules/agent/tool-executor-sandbox-tools.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("sandbox tool executor", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await db?.close();
    db = undefined;
  });

  it("returns undefined for unrecognized sandbox-prefixed tools", async () => {
    await expect(
      executeSandboxTool({}, "sandbox.unknown", "tool-call-unknown", {}, undefined),
    ).resolves.toBeUndefined();
  });

  it("requests, inspects, and releases a managed desktop for the current lane", async () => {
    db = openTestSqliteDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T13:00:00.000Z"));
    await new DesktopEnvironmentHostDal(db).upsert({
      hostId: "host-1",
      label: "Desktop host",
      dockerAvailable: true,
      healthy: true,
    });
    vi.spyOn(DesktopEnvironmentDal.prototype, "create").mockResolvedValue({
      environment_id: "env-1",
      host_id: "host-1",
      label: "tool-desktop",
      image_ref: "ghcr.io/example/workboard-desktop:test",
      managed_kind: "docker",
      status: "starting",
      desired_running: true,
      node_id: null,
      takeover_url: null,
      last_seen_at: null,
      last_error: null,
      created_at: "2026-03-22T13:00:00.000Z",
      updated_at: "2026-03-22T13:00:00.000Z",
    });
    vi.spyOn(DesktopEnvironmentDal.prototype, "get").mockResolvedValue({
      environment_id: "env-1",
      host_id: "host-1",
      label: "tool-desktop",
      image_ref: "ghcr.io/example/workboard-desktop:test",
      managed_kind: "docker",
      status: "running",
      desired_running: true,
      node_id: "node-1",
      takeover_url: null,
      last_seen_at: "2026-03-22T13:00:00.000Z",
      last_error: null,
      created_at: "2026-03-22T13:00:00.000Z",
      updated_at: "2026-03-22T13:00:00.000Z",
    });
    vi.spyOn(DesktopEnvironmentLifecycleService.prototype, "deleteEnvironment").mockResolvedValue(
      true,
    );

    const requestPromise = executeSandboxTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      },
      "sandbox.request",
      "tool-call-request",
      { label: "tool-desktop" },
      {
        work_session_key: "agent:default:test:default:channel:thread-sandbox",
        work_lane: "main",
      },
    );
    await vi.advanceTimersByTimeAsync(250);

    const request = JSON.parse((await requestPromise)?.output ?? "{}") as {
      managed_desktop_attached?: boolean;
      desktop_environment_id?: string;
      attached_node_id?: string;
    };
    expect(request).toMatchObject({
      managed_desktop_attached: true,
      desktop_environment_id: "env-1",
      attached_node_id: "node-1",
    });

    const current = JSON.parse(
      (
        await executeSandboxTool(
          {
            workspaceLease: {
              db,
              tenantId: DEFAULT_TENANT_ID,
              agentId: DEFAULT_AGENT_ID,
              workspaceId: DEFAULT_WORKSPACE_ID,
            },
          },
          "sandbox.current",
          "tool-call-current",
          {},
          {
            work_session_key: "agent:default:test:default:channel:thread-sandbox",
            work_lane: "main",
          },
        )
      )?.output ?? "{}",
    ) as { managed_desktop_attached?: boolean };
    expect(current.managed_desktop_attached).toBe(true);

    const released = JSON.parse(
      (
        await executeSandboxTool(
          {
            workspaceLease: {
              db,
              tenantId: DEFAULT_TENANT_ID,
              agentId: DEFAULT_AGENT_ID,
              workspaceId: DEFAULT_WORKSPACE_ID,
            },
          },
          "sandbox.release",
          "tool-call-release",
          {},
          {
            work_session_key: "agent:default:test:default:channel:thread-sandbox",
            work_lane: "main",
          },
        )
      )?.output ?? "{}",
    ) as { released?: boolean; attachment?: { managed_desktop_attached?: boolean } };
    expect(released).toMatchObject({
      released: true,
      attachment: { managed_desktop_attached: false },
    });
    await expect(
      new SessionLaneNodeAttachmentDal(db).get({
        tenantId: DEFAULT_TENANT_ID,
        key: "agent:default:test:default:channel:thread-sandbox",
        lane: "main",
      }),
    ).resolves.toBeUndefined();
  });

  it("hands off a managed desktop to another subagent lane", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const targetSubagent = await workboard.createSubagent({
      scope,
      subagentId: "423e4567-e89b-12d3-a456-426614174111",
      subagent: {
        execution_profile: "executor_rw",
        session_key: "agent:default:subagent:423e4567-e89b-12d3-a456-426614174111",
        lane: "subagent",
        status: "running",
      },
    });
    const attachmentDal = new SessionLaneNodeAttachmentDal(db);
    await new DesktopEnvironmentHostDal(db).upsert({
      hostId: "host-1",
      label: "Desktop host",
      dockerAvailable: true,
      healthy: true,
    });
    await attachmentDal.upsert({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:default:test:default:channel:thread-handoff",
      lane: "main",
      desktopEnvironmentId: "env-1",
      attachedNodeId: "node-1",
      lastActivityAtMs: 1,
      updatedAtMs: 1,
    });
    await db.run(
      `INSERT INTO desktop_environments (
         environment_id, tenant_id, host_id, label, image_ref, managed_kind, status,
         desired_running, node_id, logs_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'docker', 'running', 1, ?, '[]', ?, ?)`,
      [
        "env-1",
        DEFAULT_TENANT_ID,
        "host-1",
        "handoff",
        "ghcr.io/example/workboard-desktop:test",
        "node-1",
        "2026-03-22T13:00:00.000Z",
        "2026-03-22T13:00:00.000Z",
      ],
    );

    const handoff = JSON.parse(
      (
        await executeSandboxTool(
          {
            workspaceLease: {
              db,
              tenantId: DEFAULT_TENANT_ID,
              agentId: DEFAULT_AGENT_ID,
              workspaceId: DEFAULT_WORKSPACE_ID,
            },
          },
          "sandbox.handoff",
          "tool-call-handoff",
          {
            target_key: targetSubagent.session_key,
            target_lane: "subagent",
          },
          {
            work_session_key: "agent:default:test:default:channel:thread-handoff",
            work_lane: "main",
          },
        )
      )?.output ?? "{}",
    ) as {
      source?: { managed_desktop_attached?: boolean };
      target?: { managed_desktop_attached?: boolean; desktop_environment_id?: string };
    };

    expect(handoff.source?.managed_desktop_attached).toBe(false);
    expect(handoff.target).toMatchObject({
      managed_desktop_attached: true,
      desktop_environment_id: "env-1",
    });
  });
});
