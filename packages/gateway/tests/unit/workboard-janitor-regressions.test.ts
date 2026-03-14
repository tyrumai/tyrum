import { afterEach, describe, expect, it, vi } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { SessionLaneNodeAttachmentDal } from "../../src/modules/agent/session-lane-node-attachment-dal.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { SubagentJanitor } from "../../src/modules/workboard/subagent-janitor.js";
import * as orchestrationSupport from "../../src/modules/workboard/orchestration-support.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

describe("SubagentJanitor regressions", () => {
  let db: SqliteDb | undefined;
  let attachmentDal: SessionLaneNodeAttachmentDal | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    await db?.close();
    db = undefined;
    attachmentDal = undefined;
  });

  it("keeps lane attachments when closing a planner subagent fails", async () => {
    db = openTestSqliteDb();
    attachmentDal = new SessionLaneNodeAttachmentDal(db);
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const item = await workboard.createItem({
      scope,
      createdFromSessionKey: "agent:default:test:default:channel:thread-janitor-close",
      item: { kind: "action", title: "Planner cleanup guard", acceptance: { done: true } },
    });
    await workboard.transitionItem({ scope, work_item_id: item.work_item_id, status: "ready" });
    const subagent = await workboard.createSubagent({
      scope,
      subagentId: "523e4567-e89b-12d3-a456-426614174111",
      subagent: {
        execution_profile: "planner",
        session_key: "agent:default:subagent:523e4567-e89b-12d3-a456-426614174111",
        lane: "subagent",
        status: "running",
        work_item_id: item.work_item_id,
      },
    });
    await attachmentDal.upsert({
      tenantId: DEFAULT_TENANT_ID,
      key: subagent.session_key,
      lane: subagent.lane,
      attachedNodeId: "node-still-attached",
      updatedAtMs: 1,
    });

    vi.spyOn(WorkboardDal.prototype, "markSubagentClosed").mockRejectedValueOnce(
      new Error("close failed"),
    );

    const janitor = new SubagentJanitor({
      db,
      sessionLaneNodeAttachmentDal: attachmentDal,
    });
    await janitor.tick();

    expect(
      await workboard.getSubagent({
        scope,
        subagent_id: subagent.subagent_id,
      }),
    ).toMatchObject({ status: "running" });
    expect(
      await attachmentDal.get({
        tenantId: DEFAULT_TENANT_ID,
        key: subagent.session_key,
        lane: subagent.lane,
      }),
    ).toMatchObject({ attached_node_id: "node-still-attached" });
  });

  it("keeps lane attachments when managed desktop cleanup fails", async () => {
    db = openTestSqliteDb();
    attachmentDal = new SessionLaneNodeAttachmentDal(db);
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const subagent = await workboard.createSubagent({
      scope,
      subagentId: "623e4567-e89b-12d3-a456-426614174111",
      subagent: {
        execution_profile: "executor_rw",
        session_key: "agent:default:subagent:623e4567-e89b-12d3-a456-426614174111",
        lane: "subagent",
        status: "closed",
        desktop_environment_id: "desktop-env-1",
        attached_node_id: "desktop-node-1",
      },
    });
    await attachmentDal.upsert({
      tenantId: DEFAULT_TENANT_ID,
      key: subagent.session_key,
      lane: subagent.lane,
      attachedNodeId: "desktop-node-1",
      updatedAtMs: 1,
    });

    vi.spyOn(orchestrationSupport, "cleanupManagedDesktop").mockRejectedValueOnce(
      new Error("desktop still in use"),
    );

    const janitor = new SubagentJanitor({
      db,
      sessionLaneNodeAttachmentDal: attachmentDal,
    });
    await janitor.tick();

    expect(
      await workboard.getSubagent({
        scope,
        subagent_id: subagent.subagent_id,
      }),
    ).toMatchObject({
      desktop_environment_id: "desktop-env-1",
      attached_node_id: "desktop-node-1",
    });
    expect(
      await attachmentDal.get({
        tenantId: DEFAULT_TENANT_ID,
        key: subagent.session_key,
        lane: subagent.lane,
      }),
    ).toMatchObject({ attached_node_id: "desktop-node-1" });
  });
});
