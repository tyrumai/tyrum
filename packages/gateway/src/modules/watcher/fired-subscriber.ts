/**
 * Subscribes to watcher:fired events and enqueues execution plans.
 *
 * Bridges the watcher scheduler to the execution engine by calling
 * enqueuePlan() when a watcher fires, and updating the watcher_firings
 * row status to 'enqueued' or 'failed'.
 */

import type { Emitter } from "mitt";
import type { GatewayEvents } from "../../event-bus.js";
import type { SqlDb } from "../../statestore/types.js";
import type { ExecutionEngine } from "../execution/engine.js";
import type { Logger } from "../observability/logger.js";

export interface WatcherFiredSubscriberOpts {
  db: SqlDb;
  eventBus: Emitter<GatewayEvents>;
  engine: ExecutionEngine;
  logger?: Logger;
}

export class WatcherFiredSubscriber {
  private readonly db: SqlDb;
  private readonly eventBus: Emitter<GatewayEvents>;
  private readonly engine: ExecutionEngine;
  private readonly logger?: Logger;
  private handler: ((event: GatewayEvents["watcher:fired"]) => void) | undefined;

  constructor(opts: WatcherFiredSubscriberOpts) {
    this.db = opts.db;
    this.eventBus = opts.eventBus;
    this.engine = opts.engine;
    this.logger = opts.logger;
  }

  start(): void {
    if (this.handler) return;
    this.handler = (event) => {
      void this.handleFiring(event);
    };
    this.eventBus.on("watcher:fired", this.handler);
  }

  stop(): void {
    if (this.handler) {
      this.eventBus.off("watcher:fired", this.handler);
      this.handler = undefined;
    }
  }

  private async handleFiring(event: GatewayEvents["watcher:fired"]): Promise<void> {
    const { firingId, planId, watcherId } = event;
    if (!firingId) return;

    try {
      await this.engine.enqueuePlan({
        key: `watcher-${String(watcherId)}`,
        lane: "watcher",
        planId,
        requestId: firingId,
        steps: [],
      });

      await this.db.run(
        `UPDATE watcher_firings SET status = 'enqueued' WHERE firing_id = ?`,
        [firingId],
      );

      this.logger?.info("watcher.firing_enqueued", {
        firing_id: firingId,
        watcher_id: watcherId,
        plan_id: planId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      await this.db.run(
        `UPDATE watcher_firings SET status = 'failed' WHERE firing_id = ?`,
        [firingId],
      ).catch(() => { /* best-effort */ });

      this.logger?.error("watcher.firing_enqueue_failed", {
        firing_id: firingId,
        watcher_id: watcherId,
        plan_id: planId,
        error: message,
      });
    }
  }
}
