import { expect, it } from "vitest";
import type { WorkboardDalFixture } from "./workboard-dal.test-support.js";

function registerStateKvTests(fixture: WorkboardDalFixture): void {
  it("updates a work item", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

    const created = await dal.createItem({
      scope,
      item: { kind: "action", title: "Old", created_from_session_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const updated = await dal.updateItem({
      scope,
      work_item_id: created.work_item_id,
      patch: {
        title: "New",
        priority: 3,
        budgets: null,
        last_active_at: "2026-02-27T00:01:00.000Z",
      },
      updatedAtIso: "2026-02-27T00:01:00.000Z",
    });

    expect(updated).toBeDefined();
    expect(updated!.title).toBe("New");
    expect(updated!.priority).toBe(3);
    expect(updated!.budgets).toBeNull();
    expect(updated!.last_active_at).toBe("2026-02-27T00:01:00.000Z");
  });

  it("sets and gets state KV (agent + work item scopes)", async () => {
    const dal = fixture.createDal();

    const baseScope = await fixture.resolveScope();
    const agentScope = {
      kind: "agent",
      ...baseScope,
    } as const;

    const agentEntry = await dal.setStateKv({
      scope: agentScope,
      key: "prefs.theme",
      value_json: { mode: "dark" },
      updatedAtIso: "2026-02-27T00:00:00.000Z",
    });
    expect(agentEntry.value_json).toEqual({ mode: "dark" });

    const agentFetched = await dal.getStateKv({ scope: agentScope, key: "prefs.theme" });
    expect(agentFetched).toMatchObject({ key: "prefs.theme", value_json: { mode: "dark" } });

    const scope = baseScope;
    const item = await dal.createItem({
      scope,
      item: { kind: "action", title: "KV", created_from_session_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const workItemScope = {
      ...agentScope,
      kind: "work_item",
      work_item_id: item.work_item_id,
    } as const;
    const wiEntry = await dal.setStateKv({
      scope: workItemScope,
      key: "branch",
      value_json: { name: "600-workboard" },
      updatedAtIso: "2026-02-27T00:00:00.000Z",
    });
    expect(wiEntry.value_json).toEqual({ name: "600-workboard" });

    const listed = await dal.listStateKv({ scope: workItemScope, prefix: "br" });
    expect(listed.entries.map((e) => e.key)).toEqual(["branch"]);
  });

  it("escapes SQL LIKE wildcards in KV prefix search", async () => {
    const dal = fixture.createDal();
    const baseScope = await fixture.resolveScope();
    const scope = {
      kind: "agent",
      ...baseScope,
    } as const;

    await dal.setStateKv({
      scope,
      key: "config_foo",
      value_json: { ok: true },
      updatedAtIso: "2026-02-27T00:00:00.000Z",
    });
    await dal.setStateKv({
      scope,
      key: "configXfoo",
      value_json: { ok: false },
      updatedAtIso: "2026-02-27T00:00:00.000Z",
    });

    await dal.setStateKv({
      scope,
      key: "pct%foo",
      value_json: { ok: true },
      updatedAtIso: "2026-02-27T00:00:00.000Z",
    });
    await dal.setStateKv({
      scope,
      key: "pctAfoo",
      value_json: { ok: false },
      updatedAtIso: "2026-02-27T00:00:00.000Z",
    });

    const underscore = await dal.listStateKv({ scope, prefix: "config_" });
    expect(underscore.entries.map((e) => e.key)).toEqual(["config_foo"]);

    const percent = await dal.listStateKv({ scope, prefix: "pct%" });
    expect(percent.entries.map((e) => e.key)).toEqual(["pct%foo"]);
  });
}

function registerArtifactTests(fixture: WorkboardDalFixture): void {
  it("rejects setting work item state KV outside the caller scope", async () => {
    const dal = fixture.createDal();

    const scopeA = await fixture.resolveScope();
    const scopeB = await fixture.resolveScope({ agentKey: "agent-b" });

    const foreignItem = await dal.createItem({
      scope: scopeB,
      item: { kind: "action", title: "Foreign", created_from_session_key: "agent:agent-b:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    await expect(
      dal.setStateKv({
        scope: {
          kind: "work_item",
          tenant_id: scopeA.tenant_id,
          agent_id: scopeA.agent_id,
          workspace_id: scopeA.workspace_id,
          work_item_id: foreignItem.work_item_id,
        },
        key: "branch",
        value_json: { name: "should-fail" },
        updatedAtIso: "2026-02-27T00:00:00.000Z",
      }),
    ).rejects.toThrow(/scope/i);
  });

  it("creates and lists artifacts for a work item", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

    const item = await dal.createItem({
      scope,
      item: { kind: "action", title: "Artifacts", created_from_session_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const artifact = await dal.createArtifact({
      scope,
      artifact: {
        work_item_id: item.work_item_id,
        kind: "candidate_plan",
        title: "Plan",
        body_md: "- step 1\n- step 2",
        refs: ["run:abc"],
        confidence: 0.9,
        provenance_json: { source: "test" },
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    expect(artifact.work_item_id).toBe(item.work_item_id);
    expect(artifact.refs).toEqual(["run:abc"]);

    const fetched = await dal.getArtifact({ scope, artifact_id: artifact.artifact_id });
    expect(fetched).toBeDefined();
    expect(fetched!.artifact_id).toBe(artifact.artifact_id);

    const listed = await dal.listArtifacts({ scope, work_item_id: item.work_item_id });
    expect(listed.artifacts.map((a) => a.artifact_id)).toEqual([artifact.artifact_id]);
  });

  it("rejects attaching artifacts outside the caller scope", async () => {
    const dal = fixture.createDal();
    const scopeA = await fixture.resolveScope();
    const scopeB = await fixture.resolveScope({ agentKey: "agent-b" });

    const foreignItem = await dal.createItem({
      scope: scopeB,
      item: { kind: "action", title: "Foreign", created_from_session_key: "agent:agent-b:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    await expect(
      dal.createArtifact({
        scope: scopeA,
        artifact: {
          work_item_id: foreignItem.work_item_id,
          kind: "risk",
          title: "Should fail",
        },
        createdAtIso: "2026-02-27T00:00:00.000Z",
      }),
    ).rejects.toThrow(/scope/i);
  });
}

function registerDecisionAndSignalTests(fixture: WorkboardDalFixture): void {
  it("rejects created_by_subagent_id outside the caller scope", async () => {
    const dal = fixture.createDal();
    const scopeA = await fixture.resolveScope();
    const scopeB = await fixture.resolveScope({ agentKey: "agent-b" });

    const foreignItem = await dal.createItem({
      scope: scopeB,
      item: { kind: "action", title: "Foreign", created_from_session_key: "agent:agent-b:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const foreignSubagentId = "00000000-0000-0000-0000-000000000099";
    const foreignSubagent = await dal.createSubagent({
      scope: scopeB,
      subagent: {
        execution_profile: "executor",
        session_key: `agent:agent-b:subagent:${foreignSubagentId}`,
        work_item_id: foreignItem.work_item_id,
      },
      subagentId: foreignSubagentId,
      createdAtIso: "2026-02-27T00:00:01.000Z",
    });

    await expect(
      dal.createArtifact({
        scope: scopeA,
        artifact: {
          kind: "risk",
          title: "Should fail",
          created_by_subagent_id: foreignSubagent.subagent_id,
        },
        createdAtIso: "2026-02-27T00:00:02.000Z",
      }),
    ).rejects.toThrow(/scope/i);

    await expect(
      dal.createDecision({
        scope: scopeA,
        decision: {
          question: "Should this be allowed?",
          chosen: "No",
          rationale_md: "Cross-scope references must be rejected.",
          created_by_subagent_id: foreignSubagent.subagent_id,
        },
        createdAtIso: "2026-02-27T00:00:03.000Z",
      }),
    ).rejects.toThrow(/scope/i);
  });

  it("creates and lists decision records", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();

    const item = await dal.createItem({
      scope,
      item: { kind: "action", title: "Decisions", created_from_session_key: "agent:default:main" },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const decision = await dal.createDecision({
      scope,
      decision: {
        work_item_id: item.work_item_id,
        question: "Which approach?",
        chosen: "Keep it simple",
        alternatives: ["Over-engineer"],
        rationale_md: "Minimize moving parts.",
        input_artifact_ids: [],
      },
      createdAtIso: "2026-02-27T00:00:00.000Z",
    });

    const fetched = await dal.getDecision({ scope, decision_id: decision.decision_id });
    expect(fetched).toBeDefined();
    expect(fetched).toMatchObject({ decision_id: decision.decision_id, chosen: "Keep it simple" });

    const listed = await dal.listDecisions({ scope, work_item_id: item.work_item_id });
    expect(listed.decisions.map((d) => d.decision_id)).toEqual([decision.decision_id]);
  });

  it("creates and updates a work signal", async () => {
    const dal = fixture.createDal();
    const scope = await fixture.resolveScope();
    const db = fixture.db();
    const createdAtIso = "2026-02-27T00:00:00.000Z";
    const updatedAtIso = "2026-02-27T00:00:02.000Z";

    const signal = await dal.createSignal({
      scope,
      signal: {
        trigger_kind: "event",
        trigger_spec_json: { on: "approval.resolved" },
        payload_json: { notify: true },
      },
      createdAtIso,
    });

    const other = await dal.createSignal({
      scope,
      signal: {
        trigger_kind: "event",
        trigger_spec_json: { on: "artifact.created" },
      },
      createdAtIso: "2026-02-27T00:00:00.500Z",
    });

    const createdRow = await db!.get<{ created_at: string; updated_at: string }>(
      `SELECT created_at, updated_at
       FROM work_signals
       WHERE tenant_id = ?
         AND signal_id = ?`,
      [scope.tenant_id, signal.signal_id],
    );
    expect(createdRow).toEqual({
      created_at: createdAtIso,
      updated_at: createdAtIso,
    });

    const updated = await dal.updateSignal({
      scope,
      signal_id: signal.signal_id,
      patch: { status: "paused" },
      updatedAtIso,
    });
    expect(updated).toBeDefined();
    expect(updated!.changed).toBe(true);
    expect(updated!.signal.status).toBe("paused");

    const fetched = await dal.getSignal({ scope, signal_id: signal.signal_id });
    expect(fetched).toBeDefined();
    expect(fetched!.status).toBe("paused");

    const updatedRow = await db!.get<{ created_at: string; updated_at: string }>(
      `SELECT created_at, updated_at
       FROM work_signals
       WHERE tenant_id = ?
         AND signal_id = ?`,
      [scope.tenant_id, signal.signal_id],
    );
    expect(updatedRow).toEqual({
      created_at: createdAtIso,
      updated_at: updatedAtIso,
    });

    const noOp = await dal.updateSignal({
      scope,
      signal_id: signal.signal_id,
      patch: { status: "paused" },
      updatedAtIso: "2026-02-27T00:00:03.000Z",
    });
    expect(noOp).toBeDefined();
    expect(noOp).toMatchObject({
      changed: false,
      signal: {
        signal_id: signal.signal_id,
        status: "paused",
      },
    });

    const unchangedRow = await db!.get<{ created_at: string; updated_at: string }>(
      `SELECT created_at, updated_at
       FROM work_signals
       WHERE tenant_id = ?
         AND signal_id = ?`,
      [scope.tenant_id, signal.signal_id],
    );
    expect(unchangedRow).toEqual({
      created_at: createdAtIso,
      updated_at: updatedAtIso,
    });

    const listed = await dal.listSignals({ scope });
    expect(listed.signals.map((s) => s.signal_id)).toEqual([other.signal_id, signal.signal_id]);

    const pausedOnly = await dal.listSignals({ scope, statuses: ["paused"] });
    expect(pausedOnly.signals.map((s) => s.signal_id)).toEqual([signal.signal_id]);
  });
}

export function registerStateTests(fixture: WorkboardDalFixture): void {
  registerStateKvTests(fixture);
  registerArtifactTests(fixture);
  registerDecisionAndSignalTests(fixture);
}
