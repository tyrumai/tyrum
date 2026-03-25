import { describe, expect, it } from "vitest";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import {
  createClusterTaskResultRelayScenario,
  createRetryOnProcessingErrorScenario,
  createSlowBroadcastDeliveryScenario,
  createSlowDirectDeliveryScenario,
  createTaskExecuteDeliveryScenario,
} from "./outbox-poller.test-support.js";
import { audienceCases, authAuditCases } from "./outbox-poller.broadcast-cases.test-support.js";

describe("OutboxPoller", () => {
  for (const testCase of authAuditCases) {
    it(testCase.name, async () => {
      const { ackConsumerCursor, poller, sockets } = testCase.createScenario();

      await poller.tick();

      expect(ackConsumerCursor).toHaveBeenCalledWith(DEFAULT_TENANT_ID, "edge-a", 1);
      for (const key of testCase.expectedSent) {
        expect(sockets[key]?.send).toHaveBeenCalledTimes(1);
      }
      for (const key of testCase.expectedSilent) {
        expect(sockets[key]?.send).not.toHaveBeenCalled();
      }
    });
  }

  it("evicts slow consumers during broadcast delivery and still reaches healthy peers", async () => {
    const { ackConsumerCursor, connectionManager, healthyWs, logger, metrics, poller, slowWs } =
      createSlowBroadcastDeliveryScenario();

    await poller.tick();

    expect(ackConsumerCursor).toHaveBeenCalledWith(DEFAULT_TENANT_ID, "edge-a", 1);
    expect(slowWs.send).not.toHaveBeenCalled();
    expect(slowWs.close).toHaveBeenCalledWith(1013, "slow consumer");
    expect(healthyWs.send).toHaveBeenCalledTimes(1);
    expect(connectionManager.getClient("slow-client")).toBeUndefined();
    expect(connectionManager.getClient("healthy-client")).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "ws.slow_consumer_evicted",
      expect.objectContaining({
        connection_id: "slow-client",
        delivery_mode: "cluster_broadcast",
        topic: "ws.broadcast",
      }),
    );
    await expect(
      metrics.registry.getSingleMetricAsString("ws_slow_consumer_evictions_total"),
    ).resolves.toMatch(/ws_slow_consumer_evictions_total\s+1(\s|$)/);
  });

  it("acks only after processing succeeds (retries on processing error)", async () => {
    const { ackConsumerCursor, poller, ws } = createRetryOnProcessingErrorScenario();

    await poller.tick();
    expect(ackConsumerCursor).not.toHaveBeenCalled();

    await poller.tick();
    expect(ackConsumerCursor).toHaveBeenCalledWith(DEFAULT_TENANT_ID, "edge-a", 1);
    expect(ws.send).toHaveBeenCalledTimes(1);
  });

  it("records dispatched attempt executors when delivering task.execute to nodes", async () => {
    const { connectionManager, poller, taskResults, ws } = createTaskExecuteDeliveryScenario();

    await poller.tick();
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(
      connectionManager.getDispatchedAttemptExecutor("0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e"),
    ).toBe("dev_test");
    expect(taskResults.getAssociatedConnectionId("task-1")).toBe("node-1");
  });

  it("resolves relayed task.execute results on the origin edge", async () => {
    const { ackConsumerCursor, poller, taskResults } = createClusterTaskResultRelayScenario();
    const awaiting = taskResults.wait("task-1", { timeoutMs: 5_000 });

    await poller.tick();

    expect(ackConsumerCursor).toHaveBeenCalledWith(DEFAULT_TENANT_ID, "edge-a", 1);
    await expect(awaiting).resolves.toEqual({ ok: true, evidence: { foo: "bar" } });
  });

  it("evicts slow consumers during direct delivery without recording attempt executors", async () => {
    const { ackConsumerCursor, attemptId, connectionManager, logger, metrics, poller, ws } =
      createSlowDirectDeliveryScenario();

    await poller.tick();

    expect(ackConsumerCursor).toHaveBeenCalledWith(DEFAULT_TENANT_ID, "edge-a", 1);
    expect(ws.send).not.toHaveBeenCalled();
    expect(ws.close).toHaveBeenCalledWith(1013, "slow consumer");
    expect(connectionManager.getClient("node-1")).toBeUndefined();
    expect(connectionManager.getDispatchedAttemptExecutor(attemptId)).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "ws.slow_consumer_evicted",
      expect.objectContaining({
        connection_id: "node-1",
        delivery_mode: "cluster_direct",
        topic: "ws.direct",
      }),
    );
    await expect(
      metrics.registry.getSingleMetricAsString("ws_slow_consumer_evictions_total"),
    ).resolves.toMatch(/ws_slow_consumer_evictions_total\s+1(\s|$)/);
  });

  for (const testCase of audienceCases) {
    it(testCase.name, async () => {
      const { ackConsumerCursor, poller, sockets } = testCase.createScenario();

      await poller.tick();

      expect(ackConsumerCursor).toHaveBeenCalledWith(DEFAULT_TENANT_ID, "edge-a", 1);
      for (const [key, count] of Object.entries(testCase.expectedSendCounts)) {
        expect(sockets[key]?.send).toHaveBeenCalledTimes(count);
      }
    });
  }
});
