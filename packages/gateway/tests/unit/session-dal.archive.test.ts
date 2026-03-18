import { describe, expect, it } from "vitest";
import { createSessionDalFixture } from "./session-dal.test-support.js";

describe("SessionDal.setArchived", () => {
  it("archives a session", async () => {
    const { dal } = createSessionDalFixture();
    const session = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });

    expect(session.archived).toBe(false);

    const changed = await dal.setArchived({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      archived: true,
    });
    expect(changed).toBe(true);

    const updated = await dal.getById({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
    });
    expect(updated?.archived).toBe(true);
  });

  it("unarchives a session", async () => {
    const { dal } = createSessionDalFixture();
    const session = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });

    await dal.setArchived({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      archived: true,
    });

    await dal.setArchived({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      archived: false,
    });

    const updated = await dal.getById({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
    });
    expect(updated?.archived).toBe(false);
  });
});

describe("SessionDal.list with archived filter", () => {
  it("excludes archived sessions by default", async () => {
    const { dal } = createSessionDalFixture();
    const s1 = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });
    const s2 = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-2",
      containerKind: "channel",
    });

    await dal.setArchived({
      tenantId: s1.tenant_id,
      sessionId: s1.session_id,
      archived: true,
    });

    const result = await dal.list({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.session_id).toBe(s2.session_key);
  });

  it("returns only archived sessions when archived=true", async () => {
    const { dal } = createSessionDalFixture();
    const s1 = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });
    await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-2",
      containerKind: "channel",
    });

    await dal.setArchived({
      tenantId: s1.tenant_id,
      sessionId: s1.session_id,
      archived: true,
    });

    const result = await dal.list({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      archived: true,
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.session_id).toBe(s1.session_key);
    expect(result.sessions[0]?.archived).toBe(true);
  });

  it("returns only active sessions when archived=false", async () => {
    const { dal } = createSessionDalFixture();
    const s1 = await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });
    await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-2",
      containerKind: "channel",
    });

    await dal.setArchived({
      tenantId: s1.tenant_id,
      sessionId: s1.session_id,
      archived: true,
    });

    const result = await dal.list({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      archived: false,
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.archived).toBe(false);
  });

  it("includes archived field in list row", async () => {
    const { dal } = createSessionDalFixture();
    await dal.getOrCreate({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: "thread-1",
      containerKind: "channel",
    });

    const result = await dal.list({
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.archived).toBe(false);
  });
});
