import type { GatewayWorkboardService } from "../../modules/workboard/service.js";
import type { ProtocolDeps } from "./types.js";
import { WORKBOARD_WS_AUDIENCE } from "../workboard-audience.js";
import { broadcastEvent } from "./helpers.js";

type OverlapWarningWorkboardService = Pick<GatewayWorkboardService, "listItems" | "createArtifact">;

export async function maybeEmitWorkItemOverlapWarningArtifact(params: {
  workboardService: OverlapWarningWorkboardService;
  scope: Parameters<OverlapWarningWorkboardService["listItems"]>[0]["scope"];
  item: { work_item_id: string; title: string; fingerprint?: { resources: string[] } };
  deps: ProtocolDeps;
  fingerprintTouched?: boolean;
}): Promise<void> {
  try {
    if (params.fingerprintTouched === false) return;

    const fingerprint = params.item.fingerprint;
    if (!fingerprint || fingerprint.resources.length === 0) return;

    const { items: active } = await params.workboardService.listItems({
      scope: params.scope,
      statuses: ["doing", "blocked"],
      limit: 200,
    });

    const resourceSet = new Set(fingerprint.resources);
    const overlaps = active
      .filter((other) => other.work_item_id !== params.item.work_item_id)
      .map((other) => {
        const shared = (other.fingerprint?.resources ?? []).filter((r) => resourceSet.has(r));
        return shared.length > 0 ? { other, shared } : null;
      })
      .filter(
        (entry): entry is { other: (typeof active)[number]; shared: string[] } => entry !== null,
      );
    if (overlaps.length === 0) return;

    const body_md = [
      "Detected overlap with active WorkItems (no auto-merge):",
      "",
      ...overlaps.map(
        ({ other, shared }) =>
          `- \`${other.work_item_id}\` — ${other.title} (shared: ${shared.join(", ")})`,
      ),
      "",
      "Suggested next steps: queue this WorkItem, link it as a dependency, or explicitly merge.",
    ].join("\n");

    const artifact = await params.workboardService.createArtifact({
      scope: params.scope,
      artifact: {
        work_item_id: params.item.work_item_id,
        kind: "risk",
        title: "WorkItem overlap detected",
        body_md,
        refs: [],
      },
    });

    broadcastEvent(
      params.scope.tenant_id,
      {
        event_id: crypto.randomUUID(),
        type: "work.artifact.created",
        occurred_at: new Date().toISOString(),
        scope: { kind: "agent", agent_id: artifact.agent_id },
        payload: { artifact },
      },
      params.deps,
      WORKBOARD_WS_AUDIENCE,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    params.deps.logger?.warn("work.item.overlap_warning_failed", { error: message });
  }
}
