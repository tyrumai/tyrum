/**
 * Playbook runner.
 *
 * Converts PlaybookStep[] into ActionPrimitive[] for the execution engine,
 * and tracks per-playbook execution metadata.
 */

import type { ActionPrimitive, Playbook, PlaybookStep } from "@tyrum/schemas";

export interface PlaybookRunResult {
  playbook_id: string;
  steps: ActionPrimitive[];
  created_at: string;
}

export interface PlaybookStats {
  playbook_id: string;
  run_count: number;
}

/** Convert a PlaybookStep to an ActionPrimitive. */
function stepToPrimitive(step: PlaybookStep, index: number): ActionPrimitive {
  return {
    type: step.action,
    args: step.args,
    postcondition: step.postcondition,
    idempotency_key: `playbook-step-${String(index)}`,
  };
}

export class PlaybookRunner {
  private readonly stats = new Map<string, number>();

  /** Convert a playbook's steps to action primitives for execution. */
  run(playbook: Playbook): PlaybookRunResult {
    const steps = playbook.manifest.steps.map(stepToPrimitive);

    const prev = this.stats.get(playbook.manifest.id) ?? 0;
    this.stats.set(playbook.manifest.id, prev + 1);

    return {
      playbook_id: playbook.manifest.id,
      steps,
      created_at: new Date().toISOString(),
    };
  }

  /** Get execution stats for all playbooks that have been run. */
  getStats(): PlaybookStats[] {
    const result: PlaybookStats[] = [];
    for (const [playbook_id, run_count] of this.stats) {
      result.push({ playbook_id, run_count });
    }
    return result;
  }
}
