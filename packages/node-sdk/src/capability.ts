/**
 * Capability provider abstraction and automatic task dispatch wiring.
 *
 * Register one or more {@link CapabilityProvider} instances and call
 * {@link autoExecute} to automatically execute dispatched tasks using
 * the matching provider and report results back to the gateway.
 */

import {
  descriptorIdsForClientCapability,
  migrateCapabilityDescriptorId,
  requiredCapabilityDescriptorForAction,
  type ActionPrimitive,
  type ClientCapability,
} from "@tyrum/contracts";
import type { TyrumClient } from "@tyrum/transport-sdk";

export interface TaskResult {
  success: boolean;
  result?: unknown;
  evidence?: unknown;
  error?: string;
}

export interface TaskExecuteContext {
  requestId: string;
  turnId: string;
  stepId: string;
  attemptId: string;
}

export interface CapabilityProvider {
  /**
   * @deprecated Use `capabilityIds` instead.
   *
   * Legacy capability kind used for backward-compatible provider lookup.
   * When `capabilityIds` is present, this field is ignored.
   */
  readonly capability?: ClientCapability;

  /**
   * Canonical capability descriptor IDs this provider handles
   * (e.g. `["tyrum.camera.capture-photo", "tyrum.audio.record"]`).
   *
   * When absent, falls back to expanding `capability` via the legacy bridge.
   */
  readonly capabilityIds?: readonly string[];

  execute(action: ActionPrimitive, ctx?: TaskExecuteContext): Promise<TaskResult>;
}

type AutoExecuteClient = Pick<TyrumClient, "on" | "respondTaskExecute">;

function resolveProviderCapabilityIds(provider: CapabilityProvider): readonly string[] {
  if (provider.capabilityIds && provider.capabilityIds.length > 0) {
    return provider.capabilityIds;
  }
  if (provider.capability) {
    return descriptorIdsForClientCapability(provider.capability).flatMap(
      migrateCapabilityDescriptorId,
    );
  }
  return [];
}

export function autoExecute(client: AutoExecuteClient, providers: CapabilityProvider[]): void {
  const capMap = new Map<string, CapabilityProvider>();
  for (const provider of providers) {
    for (const id of resolveProviderCapabilityIds(provider)) {
      capMap.set(id, provider);
    }
  }

  client.on("task_execute", (msg) => {
    const action = msg.payload.action;
    const ctx: TaskExecuteContext = {
      requestId: msg.request_id,
      turnId: msg.payload.turn_id,
      stepId: msg.payload.step_id,
      attemptId: msg.payload.attempt_id,
    };

    const respond = (
      success: boolean,
      result?: unknown,
      evidence?: unknown,
      error?: string,
    ): void => {
      try {
        client.respondTaskExecute(msg.request_id, success, result, evidence, error);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try {
          client.respondTaskExecute(
            msg.request_id,
            false,
            undefined,
            undefined,
            `task.execute response serialization failed: ${message}`,
          );
        } catch {
          // ignore
        }
      }
    };

    const descriptorId = requiredCapabilityDescriptorForAction(action);
    const provider = descriptorId ? capMap.get(descriptorId) : undefined;

    if (!provider) {
      respond(
        false,
        undefined,
        undefined,
        `no provider for capability: ${descriptorId ?? action.type}`,
      );
      return;
    }

    void Promise.resolve()
      .then(async () => await provider.execute(action, ctx))
      .then(
        (taskResult) => {
          respond(taskResult.success, taskResult.result, taskResult.evidence, taskResult.error);
        },
        (err: unknown) => {
          const errorMsg = err instanceof Error ? err.message : String(err);
          respond(false, undefined, undefined, errorMsg);
        },
      );
  });
}
