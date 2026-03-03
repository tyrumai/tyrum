import { formatElevatedModeRemaining, isElevatedModeActive } from "@tyrum/operator-core";
import { Button } from "../ui/button.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { useElevatedModeUiContext } from "./elevated-mode-provider.js";

export function ElevatedModeBanner() {
  const { core } = useElevatedModeUiContext();
  const elevatedMode = useOperatorStore(core.elevatedModeStore);

  if (!isElevatedModeActive(elevatedMode)) return null;

  return (
    <div
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-fg"
      data-testid="elevated-mode-banner"
    >
      <div>
        <span className="font-medium">Elevated Mode</span>{" "}
        <span className="text-fg-muted">
          active · {formatElevatedModeRemaining(elevatedMode)} remaining
        </span>
      </div>
      <Button
        size="sm"
        variant="danger"
        data-testid="elevated-mode-exit"
        onClick={() => {
          core.elevatedModeStore.exit();
        }}
      >
        Exit
      </Button>
    </div>
  );
}
