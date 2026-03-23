import { DeploymentConfig } from "@tyrum/contracts";
import { afterEach, expect, it, vi } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../../src/modules/desktop-environments/dal.js";
import { DesktopEnvironmentLifecycleService } from "../../src/modules/desktop-environments/lifecycle-service.js";
import { SessionLaneNodeAttachmentDal } from "../../src/modules/agent/session-lane-node-attachment-dal.js";
import {
  cleanupManagedDesktop,
  provisionManagedDesktop,
} from "../../src/modules/workboard/orchestration-support.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

let db: SqliteDb | undefined;

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db?.close();
  db = undefined;
});

const managedDesktopConfig = DeploymentConfig.parse({
  desktopEnvironments: {
    defaultImageRef: "ghcr.io/example/workboard-desktop:test",
  },
});

function createEnvironment(overrides?: {
  environmentId?: string;
  nodeId?: string | null;
}): Awaited<ReturnType<DesktopEnvironmentDal["create"]>> {
  return {
    environment_id: overrides?.environmentId ?? "env-1",
    host_id: "host-1",
    label: "Desktop test",
    image_ref: "ghcr.io/example/workboard-desktop:test",
    managed_kind: "docker",
    status: "starting",
    desired_running: true,
    node_id: overrides?.nodeId ?? null,
    takeover_url: null,
    last_seen_at: null,
    last_error: null,
    created_at: "2026-03-20T00:00:00.000Z",
    updated_at: "2026-03-20T00:00:00.000Z",
  };
}

it("returns undefined when no managed desktop host is available", async () => {
  db = openTestSqliteDb();
  vi.spyOn(DesktopEnvironmentHostDal.prototype, "list").mockResolvedValue([]);

  const created = await provisionManagedDesktop({
    db,
    tenantId: DEFAULT_TENANT_ID,
    subagentSessionKey: "agent:default:subagent:desktop-test",
    subagentLane: "subagent",
    label: "Desktop test",
  });

  expect(created).toBeUndefined();
});

it("creates and attaches a managed desktop when the environment becomes ready", async () => {
  db = openTestSqliteDb();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-20T00:00:00.000Z"));
  await new DesktopEnvironmentHostDal(db).upsert({
    hostId: "host-1",
    label: "Desktop host",
    dockerAvailable: true,
    healthy: true,
  });
  const create = vi
    .spyOn(DesktopEnvironmentDal.prototype, "create")
    .mockResolvedValue(createEnvironment());
  const get = vi.spyOn(DesktopEnvironmentDal.prototype, "get").mockResolvedValue(
    createEnvironment({
      nodeId: "node-1",
    }),
  );
  const attachmentDal = new SessionLaneNodeAttachmentDal(db);

  const createdPromise = provisionManagedDesktop({
    db,
    tenantId: DEFAULT_TENANT_ID,
    subagentSessionKey: "agent:default:subagent:desktop-test",
    subagentLane: "subagent",
    label: "Desktop test",
    updatedAtMs: 123,
    defaultDeploymentConfig: managedDesktopConfig,
  });
  await vi.advanceTimersByTimeAsync(250);

  await expect(createdPromise).resolves.toEqual({
    desktopEnvironmentId: "env-1",
    attachedNodeId: "node-1",
  });
  expect(create).toHaveBeenCalledWith({
    tenantId: DEFAULT_TENANT_ID,
    hostId: "host-1",
    label: "Desktop test",
    imageRef: "ghcr.io/example/workboard-desktop:test",
    desiredRunning: true,
  });
  expect(get).toHaveBeenCalledWith({
    tenantId: DEFAULT_TENANT_ID,
    environmentId: "env-1",
  });
  await expect(
    attachmentDal.get({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:default:subagent:desktop-test",
      lane: "subagent",
    }),
  ).resolves.toMatchObject({
    desktop_environment_id: "env-1",
    attached_node_id: "node-1",
    last_activity_at_ms: 123,
  });
});

it("returns the created desktop without attachment when refresh never yields a node", async () => {
  db = openTestSqliteDb();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-20T00:00:00.000Z"));
  await new DesktopEnvironmentHostDal(db).upsert({
    hostId: "host-1",
    label: "Desktop host",
    dockerAvailable: true,
    healthy: true,
  });
  vi.spyOn(DesktopEnvironmentDal.prototype, "create").mockResolvedValue(createEnvironment());
  const get = vi.spyOn(DesktopEnvironmentDal.prototype, "get").mockResolvedValue(undefined);
  const attachmentDal = new SessionLaneNodeAttachmentDal(db);

  const createdPromise = provisionManagedDesktop({
    db,
    tenantId: DEFAULT_TENANT_ID,
    subagentSessionKey: "agent:default:subagent:desktop-test",
    subagentLane: "subagent",
    label: "Desktop test",
    defaultDeploymentConfig: managedDesktopConfig,
  });
  await vi.advanceTimersByTimeAsync(250);

  await expect(createdPromise).resolves.toEqual({
    desktopEnvironmentId: "env-1",
    attachedNodeId: undefined,
  });
  expect(get).toHaveBeenCalledWith({
    tenantId: DEFAULT_TENANT_ID,
    environmentId: "env-1",
  });
  await expect(
    attachmentDal.get({
      tenantId: DEFAULT_TENANT_ID,
      key: "agent:default:subagent:desktop-test",
      lane: "subagent",
    }),
  ).resolves.toMatchObject({
    desktop_environment_id: "env-1",
    attached_node_id: null,
  });
});

it("delegates managed desktop cleanup to the lifecycle service", async () => {
  db = openTestSqliteDb();
  const deleteEnvironment = vi
    .spyOn(DesktopEnvironmentLifecycleService.prototype, "deleteEnvironment")
    .mockResolvedValue(undefined);

  await cleanupManagedDesktop({
    db,
    tenantId: DEFAULT_TENANT_ID,
    environmentId: "00000000-0000-4000-8000-000000000501",
  });

  expect(deleteEnvironment).toHaveBeenCalledWith({
    tenantId: DEFAULT_TENANT_ID,
    environmentId: "00000000-0000-4000-8000-000000000501",
  });
});
