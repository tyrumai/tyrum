import type { WorkScope } from "@tyrum/contracts";
import type { GatewayContainer } from "../../../container.js";
import { WorkboardDal } from "../../workboard/dal.js";

async function describeWorkItemState(input: {
  workboard: WorkboardDal;
  scope: WorkScope;
  workItemId: string;
}): Promise<string[]> {
  const [refinementPhase, dispatchPhase, activeSubagents] = await Promise.all([
    input.workboard.getStateKv({
      scope: { kind: "work_item", ...input.scope, work_item_id: input.workItemId },
      key: "work.refinement.phase",
    }),
    input.workboard.getStateKv({
      scope: { kind: "work_item", ...input.scope, work_item_id: input.workItemId },
      key: "work.dispatch.phase",
    }),
    input.workboard.listSubagents({
      scope: input.scope,
      work_item_id: input.workItemId,
      statuses: ["running", "paused"],
      limit: 8,
    }),
  ]);

  const parts: string[] = [];
  if (
    typeof refinementPhase?.value_json === "string" &&
    refinementPhase.value_json.trim().length > 0
  ) {
    parts.push(`refinement=${refinementPhase.value_json.trim()}`);
  }
  if (typeof dispatchPhase?.value_json === "string" && dispatchPhase.value_json.trim().length > 0) {
    parts.push(`dispatch=${dispatchPhase.value_json.trim()}`);
  }
  const planner = activeSubagents.subagents.find(
    (subagent) => subagent.execution_profile === "planner",
  );
  if (planner) {
    parts.push(`planner=${planner.status}`);
  }
  const executionOwners = activeSubagents.subagents.filter(
    (subagent) => subagent.execution_profile !== "planner",
  );
  if (executionOwners.length > 0) {
    parts.push(
      `owners=${executionOwners.map((subagent) => `${subagent.execution_profile}:${subagent.status}`).join(",")}`,
    );
  }
  return parts;
}

async function appendWorkItemSection(input: {
  lines: string[];
  label: string;
  items: Array<{ work_item_id: string; title: string }>;
  workboard: WorkboardDal;
  scope: WorkScope;
}): Promise<void> {
  if (input.items.length === 0) {
    return;
  }

  const details = await Promise.all(
    input.items.map((item) =>
      describeWorkItemState({
        workboard: input.workboard,
        scope: input.scope,
        workItemId: item.work_item_id,
      }),
    ),
  );

  input.lines.push(input.label);
  for (const [index, item] of input.items.entries()) {
    const parts = details[index] ?? [];
    input.lines.push(
      `- ${item.work_item_id} — ${item.title}${parts.length > 0 ? ` [${parts.join("; ")}]` : ""}`,
    );
  }
}

export async function buildWorkFocusDigest(input: {
  container: Pick<GatewayContainer, "db" | "redactionEngine" | "logger">;
  scope: WorkScope;
}): Promise<string> {
  try {
    const workboard = new WorkboardDal(input.container.db, input.container.redactionEngine);
    const [{ items: doing }, { items: blocked }, { items: ready }, { clarifications }, planners] =
      await Promise.all([
        workboard.listItems({ scope: input.scope, statuses: ["doing"], limit: 3 }),
        workboard.listItems({ scope: input.scope, statuses: ["blocked"], limit: 3 }),
        workboard.listItems({ scope: input.scope, statuses: ["ready"], limit: 3 }),
        workboard.listClarifications({ scope: input.scope, statuses: ["open"], limit: 5 }),
        workboard.listSubagents({
          scope: input.scope,
          execution_profile: "planner",
          statuses: ["running", "paused"],
          limit: 5,
        }),
      ]);

    if (
      doing.length === 0 &&
      blocked.length === 0 &&
      ready.length === 0 &&
      clarifications.length === 0 &&
      planners.subagents.length === 0
    ) {
      return "No active WorkItems.";
    }

    const lines: string[] = [];
    await appendWorkItemSection({
      lines,
      label: "Doing:",
      items: doing,
      workboard,
      scope: input.scope,
    });
    await appendWorkItemSection({
      lines,
      label: "Blocked:",
      items: blocked,
      workboard,
      scope: input.scope,
    });
    await appendWorkItemSection({
      lines,
      label: "Ready:",
      items: ready,
      workboard,
      scope: input.scope,
    });
    if (clarifications.length > 0) {
      lines.push("Open clarifications:");
      for (const clarification of clarifications) {
        lines.push(`- ${clarification.work_item_id} — ${clarification.question}`);
      }
    }
    if (planners.subagents.length > 0) {
      lines.push("Active planners:");
      for (const planner of planners.subagents) {
        lines.push(
          `- ${planner.work_item_id ?? "unassigned"} — ${planner.execution_profile}:${planner.status}`,
        );
      }
    }

    return lines.join("\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    input.container.logger.warn("workboard.focus_digest_failed", { error: message });
    return "Work focus digest unavailable.";
  }
}
