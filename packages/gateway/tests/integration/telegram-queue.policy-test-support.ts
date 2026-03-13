import { expect, it, vi } from "vitest";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import { ApprovalDal } from "../../src/modules/approval/dal.js";
import {
  TelegramChannelProcessor,
  TelegramChannelQueue,
} from "../../src/modules/channels/telegram.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import { normalizeUpdate } from "../../src/modules/ingress/telegram.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { PolicyService } from "../../src/modules/policy/service.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { PolicyBundleConfigDal } from "../../src/modules/policy/config-dal.js";
import { createGatewayConfigStore } from "../../src/modules/runtime-state/gateway-config-store.js";
import {
  createApprovalTestApp,
  createIngressApp,
  makeSessionDal,
  makeResolvedRuntime,
  makeTelegramUpdate,
  mockFetch,
  openTelegramQueueTestDb,
  postTelegramUpdate,
  type TelegramQueueTestState,
} from "./telegram-queue.test-fixtures.js";

async function createApprovalPolicyService(db: NonNullable<TelegramQueueTestState["db"]>) {
  const policyBundleDal = new PolicyBundleConfigDal(db);
  await policyBundleDal.set({
    scope: { tenantId: DEFAULT_TENANT_ID, scopeKind: "deployment" },
    bundle: {
      v: 1,
      connectors: {
        default: "require_approval",
        allow: [],
        require_approval: ["telegram:*"],
        deny: [],
      },
    },
    createdBy: { kind: "test" },
    reason: "seed",
  });

  return new PolicyService({
    home: "/tmp/unused",
    snapshotDal: new PolicySnapshotDal(db),
    overrideDal: new PolicyOverrideDal(db),
    configStore: createGatewayConfigStore({
      db,
      home: "/tmp/unused",
      deploymentConfig: {},
    }),
  });
}

async function createPolicyHarness(
  state: TelegramQueueTestState,
  options: {
    createPolicyService: (
      db: NonNullable<TelegramQueueTestState["db"]>,
    ) => Promise<PolicyService> | PolicyService;
    queueOptions?: Omit<
      NonNullable<ConstructorParameters<typeof TelegramChannelQueue>[1]>,
      "sessionDal"
    >;
    runtime?: ReturnType<typeof makeResolvedRuntime>;
  },
) {
  const db = openTelegramQueueTestDb(state);
  const sessionDal = makeSessionDal(db);
  const fetchFn = mockFetch();
  const bot = new TelegramBot("test-token", fetchFn);
  const runtime = options.runtime ?? makeResolvedRuntime("This requires approval");
  const policyService = await options.createPolicyService(db);
  const approvalDal = new ApprovalDal(db);
  const queue = new TelegramChannelQueue(db, {
    sessionDal,
    ...options.queueOptions,
  });
  const processor = new TelegramChannelProcessor({
    db,
    sessionDal,
    agents: {
      getRuntime: async () => runtime,
      getPolicyService: () => policyService,
    } as AgentRegistry,
    telegramBot: bot,
    owner: "test-owner",
    debounceMs: 0,
    maxBatch: 1,
    approvalDal,
  });

  return {
    approvalDal,
    bot,
    db,
    fetchFn,
    processor,
    queue,
    runtime,
  };
}

export function registerTelegramQueuePolicyTests(state: TelegramQueueTestState): void {
  it("formats connector approval plan ids without extra colons for account-scoped sources", async () => {
    const harness = await createPolicyHarness(state, {
      createPolicyService: createApprovalPolicyService,
    });

    await harness.queue.enqueue(normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me"))), {
      accountId: "work",
    });
    await harness.processor.tick();

    const pending = await harness.approvalDal.getPending({ tenantId: DEFAULT_TENANT_ID });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.approval_key).toBe("connector:telegram@work:123:42");
  });

  it("uses legacy connector policy match targets for default accounts", async () => {
    const runtime = makeResolvedRuntime("This requires approval");
    const evaluateConnectorAction = vi.fn().mockResolvedValue({ decision: "require_approval" });
    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateConnectorAction,
    } as unknown as PolicyService;
    const harness = await createPolicyHarness(state, {
      createPolicyService: () => policyService,
      runtime,
    });

    await harness.queue.enqueue(normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me"))), {
      accountId: "default",
    });
    await harness.processor.tick();

    expect(evaluateConnectorAction).toHaveBeenCalledTimes(1);
    expect(evaluateConnectorAction).toHaveBeenCalledWith(
      expect.objectContaining({
        matchTarget: "telegram:123",
      }),
    );
  });

  it("includes account ids in connector policy match targets for non-default accounts", async () => {
    const runtime = makeResolvedRuntime("This requires approval");
    const evaluateConnectorAction = vi.fn().mockResolvedValue({ decision: "require_approval" });
    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      evaluateConnectorAction,
    } as unknown as PolicyService;
    const harness = await createPolicyHarness(state, {
      createPolicyService: () => policyService,
      runtime,
    });

    await harness.queue.enqueue(normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me"))), {
      accountId: "work",
    });
    await harness.processor.tick();

    expect(evaluateConnectorAction).toHaveBeenCalledTimes(1);
    expect(evaluateConnectorAction).toHaveBeenCalledWith(
      expect.objectContaining({
        matchTarget: "telegram:work:123",
      }),
    );
  });

  it("policy-gates outbound sends via approvals when required", async () => {
    const harness = await createPolicyHarness(state, {
      createPolicyService: createApprovalPolicyService,
    });
    const app = createIngressApp({
      bot: harness.bot,
      queue: harness.queue,
      runtime: harness.runtime,
    });

    const res1 = await postTelegramUpdate(app, makeTelegramUpdate("Help me"));
    expect(res1.status).toBe(200);

    await harness.processor.tick();
    expect(harness.fetchFn).not.toHaveBeenCalled();

    const pending = await harness.approvalDal.getPending({ tenantId: DEFAULT_TENANT_ID });
    expect(pending).toHaveLength(1);

    await harness.approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: pending[0]!.approval_id,
      decision: "approved",
    });

    await harness.processor.tick();
    expect(harness.fetchFn).toHaveBeenCalledOnce();
  });

  it("supports approve-always destination policies for connector sends", async () => {
    let policyOverrideDal: PolicyOverrideDal | undefined;
    const harness = await createPolicyHarness(state, {
      createPolicyService: async (db) => {
        await createApprovalPolicyService(db);
        policyOverrideDal = new PolicyOverrideDal(db);
        return new PolicyService({
          home: "/tmp/unused",
          snapshotDal: new PolicySnapshotDal(db),
          overrideDal: policyOverrideDal,
          configStore: createGatewayConfigStore({
            db,
            home: "/tmp/unused",
            deploymentConfig: {},
          }),
        });
      },
      queueOptions: { agentId: "agent-1" },
    });

    await harness.queue.enqueue(normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me"))), {
      accountId: "work",
    });
    await harness.processor.tick();
    expect(harness.fetchFn).not.toHaveBeenCalled();

    const pending = await harness.approvalDal.getPending({ tenantId: DEFAULT_TENANT_ID });
    expect(pending).toHaveLength(1);
    const approvalAgentId = pending[0]!.agent_id;
    const approvalsApp = createApprovalTestApp(harness.approvalDal, policyOverrideDal!);

    const respondRes = await approvalsApp.request(`/approvals/${pending[0]!.approval_id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decision: "approved",
        mode: "always",
        overrides: [{ tool_id: "connector.send", pattern: "telegram:work:123" }],
      }),
    });
    expect(respondRes.status).toBe(200);
    expect(
      await policyOverrideDal.list({
        tenantId: DEFAULT_TENANT_ID,
        agentId: approvalAgentId,
        toolId: "connector.send",
      }),
    ).toHaveLength(1);

    await harness.processor.tick();
    expect(harness.fetchFn).toHaveBeenCalledOnce();

    await harness.queue.enqueue(
      normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me again", 123, { messageId: 43 }))),
      { accountId: "work" },
    );
    await harness.processor.tick();

    expect(harness.fetchFn).toHaveBeenCalledTimes(2);
    expect(await harness.approvalDal.getPending({ tenantId: DEFAULT_TENANT_ID })).toHaveLength(0);
  });
}
