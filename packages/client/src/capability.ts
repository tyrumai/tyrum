/**
 * Capability provider abstraction and automatic task dispatch wiring.
 *
 * Register one or more {@link CapabilityProvider} instances and call
 * {@link autoExecute} to automatically execute dispatched tasks using
 * the matching provider and report results back to the gateway.
 */

import type { ActionPrimitive, ClientCapability } from "@tyrum/schemas";
import { requiredCapability } from "@tyrum/schemas";
import type { TyrumClient } from "./ws-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskResult {
  success: boolean;
  evidence?: unknown;
  error?: string;
}

export interface CapabilityProvider {
  readonly capability: ClientCapability;
  execute(action: ActionPrimitive): Promise<TaskResult>;
}

// ---------------------------------------------------------------------------
// autoExecute
// ---------------------------------------------------------------------------

/**
 * Wires {@link CapabilityProvider}s to a {@link TyrumClient} -- automatically
 * executes dispatched tasks using the matching provider and reports results.
 */
export function autoExecute(
  client: TyrumClient,
  providers: CapabilityProvider[],
): void {
  const capMap = new Map<ClientCapability, CapabilityProvider>();
  for (const provider of providers) {
    capMap.set(provider.capability, provider);
  }

  client.on("task_dispatch", (msg) => {
    const required = requiredCapability(msg.action.type);
    const provider = required ? capMap.get(required) : undefined;

    if (!provider) {
      client.sendTaskResult(
        msg.task_id,
        false,
        undefined,
        `no provider for capability: ${required ?? msg.action.type}`,
      );
      return;
    }

    provider.execute(msg.action).then(
      (result) => {
        client.sendTaskResult(
          msg.task_id,
          result.success,
          result.evidence,
          result.error,
        );
      },
      (err: unknown) => {
        const errorMsg =
          err instanceof Error ? err.message : String(err);
        client.sendTaskResult(msg.task_id, false, undefined, errorMsg);
      },
    );
  });
}
