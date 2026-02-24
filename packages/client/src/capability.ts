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
  result?: unknown;
  evidence?: unknown;
  error?: string;
}

export interface TaskExecuteContext {
  requestId: string;
  runId: string;
  stepId: string;
  attemptId: string;
}

export interface CapabilityProvider {
  readonly capability: ClientCapability;
  execute(action: ActionPrimitive, ctx?: TaskExecuteContext): Promise<TaskResult>;
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

  client.on("task_execute", (msg) => {
    const action = msg.payload.action;
    const ctx: TaskExecuteContext = {
      requestId: msg.request_id,
      runId: msg.payload.run_id,
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

    const required = requiredCapability(action.type);
    const provider = required ? capMap.get(required) : undefined;

    if (!provider) {
      respond(false, undefined, undefined, `no provider for capability: ${required ?? action.type}`);
      return;
    }

    void Promise.resolve()
      .then(async () => await provider.execute(action, ctx))
      .then(
        (taskResult) => {
          respond(
            taskResult.success,
            taskResult.result,
            taskResult.evidence,
            taskResult.error,
          );
        },
        (err: unknown) => {
          const errorMsg = err instanceof Error ? err.message : String(err);
          respond(false, undefined, undefined, errorMsg);
        },
      );
  });
}
