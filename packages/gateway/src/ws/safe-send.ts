import type { Logger, LogFields } from "../app/modules/observability/logger.js";
import { gatewayMetrics, type MetricsRegistry } from "../app/modules/observability/metrics.js";
import type { ConnectedClient, ConnectionManager } from "./connection-manager.js";

const WS_OPEN_READY_STATE = 1;

export const DEFAULT_WS_MAX_BUFFERED_BYTES = 5 * 1024 * 1024;
export const WS_SLOW_CONSUMER_CLOSE_CODE = 1013;
export const WS_SLOW_CONSUMER_CLOSE_REASON = "slow consumer";

export interface SafeSendWsOptions {
  connectionManager?: ConnectionManager;
  deliveryMode?: string;
  logFields?: LogFields;
  logger?: Pick<Logger, "warn">;
  maxBufferedBytes?: number;
  metrics?: MetricsRegistry;
  sendFailureLogMessage?: string;
  slowConsumerLogMessage?: string;
  topic?: string;
}

function normalizeMaxBufferedBytes(value: number | undefined): number {
  return Math.max(0, Math.floor(value ?? DEFAULT_WS_MAX_BUFFERED_BYTES));
}

function recordMetric(cb: () => void): void {
  try {
    cb();
  } catch (error) {
    void error;
  }
}

function warn(logger: Pick<Logger, "warn"> | undefined, message: string, fields: LogFields): void {
  try {
    logger?.warn(message, fields);
  } catch (error) {
    void error;
  }
}

function buildLogFields(
  peer: ConnectedClient,
  options: SafeSendWsOptions,
  extra: LogFields = {},
): LogFields {
  return {
    connection_id: peer.id,
    delivery_mode: options.deliveryMode,
    tenant_id: peer.auth_claims?.tenant_id,
    topic: options.topic,
    ...options.logFields,
    ...extra,
  };
}

function removePeer(connectionManager: ConnectionManager | undefined, peer: ConnectedClient): void {
  if (!connectionManager) return;
  if (typeof peer.id !== "string" || peer.id.length === 0) return;
  if (!("removeClient" in connectionManager)) return;
  if (typeof connectionManager.removeClient !== "function") return;
  connectionManager.removeClient(peer.id);
}

function closeSlowConsumer(
  connectionManager: ConnectionManager | undefined,
  peer: ConnectedClient,
): void {
  try {
    if (typeof peer.ws.close === "function") {
      peer.ws.close(WS_SLOW_CONSUMER_CLOSE_CODE, WS_SLOW_CONSUMER_CLOSE_REASON);
    }
  } catch (error) {
    void error;
    try {
      if (typeof peer.ws.terminate === "function") {
        peer.ws.terminate();
      }
    } catch (terminateError) {
      void terminateError;
    }
  } finally {
    removePeer(connectionManager, peer);
  }
}

export function safeSendWs(
  peer: ConnectedClient,
  payload: string,
  options: SafeSendWsOptions = {},
): boolean {
  const readyState =
    typeof peer.ws.readyState === "number" ? peer.ws.readyState : WS_OPEN_READY_STATE;
  if (readyState !== WS_OPEN_READY_STATE) {
    removePeer(options.connectionManager, peer);
    return false;
  }

  const metrics = options.metrics ?? gatewayMetrics;
  const maxBufferedBytes = normalizeMaxBufferedBytes(options.maxBufferedBytes);
  const bufferedAmount =
    typeof peer.ws.bufferedAmount === "number" ? Math.max(0, peer.ws.bufferedAmount) : undefined;

  if (bufferedAmount !== undefined && bufferedAmount > maxBufferedBytes) {
    recordMetric(() => metrics.wsSlowConsumerEvictionsTotal.inc());
    recordMetric(() => metrics.wsSlowConsumerBufferedAmountBytes.observe(bufferedAmount));
    warn(
      options.logger,
      options.slowConsumerLogMessage ?? "ws.slow_consumer_evicted",
      buildLogFields(peer, options, {
        buffered_amount: bufferedAmount,
        max_buffered_bytes: maxBufferedBytes,
      }),
    );
    closeSlowConsumer(options.connectionManager, peer);
    return false;
  }

  try {
    peer.ws.send(payload);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordMetric(() => metrics.wsSendFailuresTotal.inc());
    warn(
      options.logger,
      options.sendFailureLogMessage ?? "ws.send_failed",
      buildLogFields(peer, options, {
        buffered_amount: bufferedAmount,
        error: message,
      }),
    );
    return false;
  }
}
