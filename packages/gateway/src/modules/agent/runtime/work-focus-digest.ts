import type { WorkScope } from "@tyrum/schemas";
import type { GatewayContainer } from "../../../container.js";
import { WorkboardDal } from "../../workboard/dal.js";

export async function buildWorkFocusDigest(input: {
  container: Pick<GatewayContainer, "db" | "redactionEngine" | "logger">;
  scope: WorkScope;
}): Promise<string> {
  try {
    const workboard = new WorkboardDal(input.container.db, input.container.redactionEngine);
    const [{ items: doing }, { items: blocked }, { items: ready }] = await Promise.all([
      workboard.listItems({ scope: input.scope, statuses: ["doing"], limit: 3 }),
      workboard.listItems({ scope: input.scope, statuses: ["blocked"], limit: 3 }),
      workboard.listItems({ scope: input.scope, statuses: ["ready"], limit: 3 }),
    ]);

    if (doing.length === 0 && blocked.length === 0 && ready.length === 0) {
      return "No active WorkItems.";
    }

    const lines: string[] = [];
    if (doing.length > 0) {
      lines.push("Doing:");
      for (const item of doing) lines.push(`- ${item.work_item_id} — ${item.title}`);
    }
    if (blocked.length > 0) {
      lines.push("Blocked:");
      for (const item of blocked) lines.push(`- ${item.work_item_id} — ${item.title}`);
    }
    if (ready.length > 0) {
      lines.push("Ready:");
      for (const item of ready) lines.push(`- ${item.work_item_id} — ${item.title}`);
    }

    return lines.join("\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    input.container.logger.warn("workboard.focus_digest_failed", { error: message });
    return "Work focus digest unavailable.";
  }
}
