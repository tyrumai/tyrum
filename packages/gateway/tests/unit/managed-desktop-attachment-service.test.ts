import { afterEach, describe, expect, it, vi } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { SessionLaneNodeAttachmentDal } from "../../src/modules/agent/session-lane-node-attachment-dal.js";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../../src/modules/desktop-environments/dal.js";
import { ManagedDesktopAttachmentService } from "../../src/modules/desktop-environments/managed-desktop-attachment-service.js";
import { DesktopEnvironmentLifecycleService } from "../../src/modules/desktop-environments/lifecycle-service.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("ManagedDesktopAttachmentService", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    await db?.close();
    db = undefined;
  });

  it("requests a managed desktop, records the attachment, and mirrors subagent state", async () => {
    db = openTestSqliteDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));

    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const subagent = await workboard.createSubagent({
      scope,
      subagentId: "123e4567-e89b-12d3-a456-426614174111",
      subagent: {
        execution_profile: "executor_rw",
        session_key: "agent:default:subagent:123e4567-e89b-12d3-a456-426614174111",
        lane: "subagent",
        status: "running",
      },
    });
    await new DesktopEnvironmentHostDal(db).upsert({
      hostId: "host-1",
      label: "Desktop host",
      dockerAvailable: true,
      healthy: true,
    });

    vi.spyOn(DesktopEnvironmentDal.prototype, "create").mockResolvedValue({
      environment_id: "env-1",
      host_id: "host-1",
      label: "executor:test",
      image_ref: "ghcr.io/example/workboard-desktop:test",
      managed_kind: "docker",
      status: "starting",
      desired_running: true,
      node_id: null,
      takeover_url: null,
      last_seen_at: null,
      last_error: null,
      created_at: "2026-03-22T12:00:00.000Z",
      updated_at: "2026-03-22T12:00:00.000Z",
    });
    vi.spyOn(DesktopEnvironmentDal.prototype, "get").mockResolvedValue({
      environment_id: "env-1",
      host_id: "host-1",
      label: "executor:test",
      image_ref: "ghcr.io/example/workboard-desktop:test",
      managed_kind: "docker",
      status: "running",
      desired_running: true,
      node_id: "node-1",
      takeover_url: null,
      last_seen_at: "2026-03-22T12:00:00.000Z",
      last_error: null,
      created_at: "2026-03-22T12:00:00.000Z",
      updated_at: "2026-03-22T12:00:00.000Z",
    });

    const service = new ManagedDesktopAttachmentService({ db });
    const requestedPromise = service.requestManagedDesktop({
      tenantId: DEFAULT_TENANT_ID,
      key: subagent.conversation_key,
      lane: "subagent",
      label: "executor:test",
      updatedAtMs: 123,
    });
    await vi.advanceTimersByTimeAsync(250);

    await expect(requestedPromise).resolves.toMatchObject({
      managed_desktop_attached: true,
      desktop_environment_id: "env-1",
      attached_node_id: "node-1",
      last_activity_at_ms: 123,
    });
    await expect(
      new SessionLaneNodeAttachmentDal(db).get({
        tenantId: DEFAULT_TENANT_ID,
        key: subagent.conversation_key,
        lane: "subagent",
      }),
    ).resolves.toMatchObject({
      desktop_environment_id: "env-1",
      attached_node_id: "node-1",
      last_activity_at_ms: 123,
    });
    await expect(
      workboard.getSubagent({
        scope,
        subagent_id: subagent.subagent_id,
      }),
    ).resolves.toMatchObject({
      desktop_environment_id: "env-1",
      attached_node_id: "node-1",
    });
  });

  it("hands a managed desktop from one subagent lane to another", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const sourceSubagent = await workboard.createSubagent({
      scope,
      subagentId: "223e4567-e89b-12d3-a456-426614174111",
      subagent: {
        execution_profile: "executor_rw",
        session_key: "agent:default:subagent:223e4567-e89b-12d3-a456-426614174111",
        lane: "subagent",
        status: "running",
        desktop_environment_id: "env-1",
        attached_node_id: "node-1",
      },
    });
    const targetSubagent = await workboard.createSubagent({
      scope,
      subagentId: "323e4567-e89b-12d3-a456-426614174111",
      subagent: {
        execution_profile: "executor_rw",
        session_key: "agent:default:subagent:323e4567-e89b-12d3-a456-426614174111",
        lane: "subagent",
        status: "running",
      },
    });
    await new DesktopEnvironmentHostDal(db).upsert({
      hostId: "host-1",
      label: "Desktop host",
      dockerAvailable: true,
      healthy: true,
    });
    await new DesktopEnvironmentDal(db).create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "handoff",
      imageRef: "ghcr.io/example/workboard-desktop:test",
      desiredRunning: true,
    });
    await db.run(
      `UPDATE desktop_environments
       SET environment_id = ?, node_id = ?, status = 'running'
       WHERE tenant_id = ?`,
      ["env-1", "node-1", DEFAULT_TENANT_ID],
    );
    await new SessionLaneNodeAttachmentDal(db).upsert({
      tenantId: DEFAULT_TENANT_ID,
      key: sourceSubagent.conversation_key,
      lane: "subagent",
      desktopEnvironmentId: "env-1",
      attachedNodeId: "node-1",
      lastActivityAtMs: 1,
      updatedAtMs: 1,
    });

    const service = new ManagedDesktopAttachmentService({ db });
    const handoff = await service.handoffManagedDesktop({
      tenantId: DEFAULT_TENANT_ID,
      sourceKey: sourceSubagent.conversation_key,
      sourceLane: "subagent",
      targetKey: targetSubagent.conversation_key,
      targetLane: "subagent",
      updatedAtMs: 55,
    });

    expect(handoff.source.managed_desktop_attached).toBe(false);
    expect(handoff.target).toMatchObject({
      managed_desktop_attached: true,
      desktop_environment_id: "env-1",
      attached_node_id: "node-1",
      last_activity_at_ms: 55,
    });
    await expect(
      new SessionLaneNodeAttachmentDal(db).get({
        tenantId: DEFAULT_TENANT_ID,
        key: sourceSubagent.conversation_key,
        lane: "subagent",
      }),
    ).resolves.toBeUndefined();
    await expect(
      new SessionLaneNodeAttachmentDal(db).get({
        tenantId: DEFAULT_TENANT_ID,
        key: targetSubagent.conversation_key,
        lane: "subagent",
      }),
    ).resolves.toMatchObject({
      desktop_environment_id: "env-1",
      attached_node_id: "node-1",
    });
    await expect(
      workboard.getSubagent({
        scope,
        subagent_id: sourceSubagent.subagent_id,
      }),
    ).resolves.toMatchObject({
      desktop_environment_id: undefined,
      attached_node_id: undefined,
    });
    await expect(
      workboard.getSubagent({
        scope,
        subagent_id: targetSubagent.subagent_id,
      }),
    ).resolves.toMatchObject({
      desktop_environment_id: "env-1",
      attached_node_id: "node-1",
    });
  });

  it("hands off a hydrated managed desktop while preserving the source device row", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const targetSubagent = await workboard.createSubagent({
      scope,
      subagentId: "523e4567-e89b-12d3-a456-426614174111",
      subagent: {
        execution_profile: "executor_rw",
        session_key: "agent:default:subagent:523e4567-e89b-12d3-a456-426614174111",
        lane: "subagent",
        status: "running",
      },
    });
    const attachmentDal = new SessionLaneNodeAttachmentDal(db);
    const environmentDal = new DesktopEnvironmentDal(db);
    await new DesktopEnvironmentHostDal(db).upsert({
      hostId: "host-1",
      label: "Desktop host",
      dockerAvailable: true,
      healthy: true,
    });
    const environment = await environmentDal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "handoff-hydrated",
      imageRef: "ghcr.io/example/workboard-desktop:test",
      desiredRunning: true,
    });
    await attachmentDal.upsert({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:default:test:default:channel:thread-handoff-hydrated",
      lane: "main",
      sourceClientDeviceId: "device-1",
      desktopEnvironmentId: environment.environment_id,
      attachedNodeId: null,
      lastActivityAtMs: 1,
      updatedAtMs: 1,
    });
    await environmentDal.updateRuntime({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      status: "running",
      nodeId: "node-1",
    });

    const service = new ManagedDesktopAttachmentService({ db });
    const handoff = await service.handoffManagedDesktop({
      tenantId: DEFAULT_TENANT_ID,
      sourceKey: "agent:default:test:default:channel:thread-handoff-hydrated",
      sourceLane: "main",
      targetKey: targetSubagent.conversation_key,
      targetLane: "subagent",
      updatedAtMs: 55,
    });

    expect(handoff.source.managed_desktop_attached).toBe(false);
    expect(handoff.target).toMatchObject({
      managed_desktop_attached: true,
      desktop_environment_id: environment.environment_id,
      attached_node_id: "node-1",
      last_activity_at_ms: 55,
    });
    const clearedSource = await attachmentDal.get({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:default:test:default:channel:thread-handoff-hydrated",
      lane: "main",
    });
    expect(clearedSource).toMatchObject({
      source_client_device_id: "device-1",
      desktop_environment_id: null,
      attached_node_id: null,
    });
    expect(clearedSource?.last_activity_at_ms).toBeGreaterThanOrEqual(55);
    await expect(
      attachmentDal.get({
        tenantId: DEFAULT_TENANT_ID,
        key: targetSubagent.conversation_key,
        lane: "subagent",
      }),
    ).resolves.toMatchObject({
      desktop_environment_id: environment.environment_id,
      attached_node_id: "node-1",
    });
  });

  it("releases a managed desktop and clears the lane attachment", async () => {
    db = openTestSqliteDb();
    const attachmentDal = new SessionLaneNodeAttachmentDal(db);
    const environmentDal = new DesktopEnvironmentDal(db);
    await new DesktopEnvironmentHostDal(db).upsert({
      hostId: "host-1",
      label: "Desktop host",
      dockerAvailable: true,
      healthy: true,
    });
    const environment = await environmentDal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "release-test",
      imageRef: "ghcr.io/example/workboard-desktop:test",
      desiredRunning: true,
    });
    await environmentDal.updateRuntime({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      status: "running",
      nodeId: "node-1",
    });
    await attachmentDal.upsert({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:default:test:default:channel:thread-release",
      lane: "main",
      desktopEnvironmentId: environment.environment_id,
      attachedNodeId: "node-1",
      lastActivityAtMs: 1,
      updatedAtMs: 1,
    });
    vi.spyOn(DesktopEnvironmentLifecycleService.prototype, "deleteEnvironment").mockResolvedValue(
      true,
    );

    const service = new ManagedDesktopAttachmentService({ db });
    const released = await service.releaseManagedDesktop({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:default:test:default:channel:thread-release",
      lane: "main",
    });

    expect(released.released).toBe(true);
    expect(released.attachment.managed_desktop_attached).toBe(false);
    await expect(
      attachmentDal.get({
        tenantId: DEFAULT_TENANT_ID,
        key: "agent:default:test:default:channel:thread-release",
        lane: "main",
      }),
    ).resolves.toBeUndefined();
  });

  it("keeps sandbox.request idempotent when the lane already owns a managed desktop", async () => {
    db = openTestSqliteDb();
    const attachmentDal = new SessionLaneNodeAttachmentDal(db);
    const environmentDal = new DesktopEnvironmentDal(db);
    await new DesktopEnvironmentHostDal(db).upsert({
      hostId: "host-1",
      label: "Desktop host",
      dockerAvailable: true,
      healthy: true,
    });
    const environment = await environmentDal.create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "request-idempotent",
      imageRef: "ghcr.io/example/workboard-desktop:test",
      desiredRunning: true,
    });
    await environmentDal.updateRuntime({
      tenantId: DEFAULT_TENANT_ID,
      environmentId: environment.environment_id,
      status: "running",
      nodeId: "node-1",
    });
    await attachmentDal.upsert({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:default:test:default:channel:thread-request-idempotent",
      lane: "main",
      desktopEnvironmentId: environment.environment_id,
      attachedNodeId: "node-1",
      lastActivityAtMs: 5,
      updatedAtMs: 5,
    });
    const createEnvironment = vi.spyOn(DesktopEnvironmentDal.prototype, "create");

    const service = new ManagedDesktopAttachmentService({ db });
    await expect(
      service.requestManagedDesktop({
        tenantId: DEFAULT_TENANT_ID,
        key: "agent:default:test:default:channel:thread-request-idempotent",
        lane: "main",
        label: "request-idempotent",
      }),
    ).resolves.toMatchObject({
      managed_desktop_attached: true,
      desktop_environment_id: environment.environment_id,
      attached_node_id: "node-1",
      last_activity_at_ms: 5,
    });
    expect(createEnvironment).not.toHaveBeenCalled();
  });

  it("rejects handoff when the target lane is not present in the current tenant", async () => {
    db = openTestSqliteDb();
    const attachmentDal = new SessionLaneNodeAttachmentDal(db);
    await new DesktopEnvironmentHostDal(db).upsert({
      hostId: "host-1",
      label: "Desktop host",
      dockerAvailable: true,
      healthy: true,
    });
    await new DesktopEnvironmentDal(db).create({
      tenantId: DEFAULT_TENANT_ID,
      hostId: "host-1",
      label: "handoff-missing-target",
      imageRef: "ghcr.io/example/workboard-desktop:test",
      desiredRunning: true,
    });
    await db.run(
      `UPDATE desktop_environments
       SET environment_id = ?, node_id = ?, status = 'running'
       WHERE tenant_id = ?`,
      ["env-missing-target", "node-1", DEFAULT_TENANT_ID],
    );
    await attachmentDal.upsert({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:default:test:default:channel:thread-handoff-source",
      lane: "main",
      desktopEnvironmentId: "env-missing-target",
      attachedNodeId: "node-1",
      lastActivityAtMs: 1,
      updatedAtMs: 1,
    });

    const service = new ManagedDesktopAttachmentService({ db });
    await expect(
      service.handoffManagedDesktop({
        tenantId: DEFAULT_TENANT_ID,
        sourceKey: "agent:default:test:default:channel:thread-handoff-source",
        sourceLane: "main",
        targetKey: "agent:default:subagent:423e4567-e89b-12d3-a456-426614174111",
        targetLane: "subagent",
      }),
    ).rejects.toThrow("target subagent lane was not found in the current tenant");
    await expect(
      attachmentDal.get({
        tenantId: DEFAULT_TENANT_ID,
        key: "agent:default:test:default:channel:thread-handoff-source",
        lane: "main",
      }),
    ).resolves.toMatchObject({
      desktop_environment_id: "env-missing-target",
      attached_node_id: "node-1",
    });
  });
});
