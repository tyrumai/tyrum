import { isElevatedModeActive } from "@tyrum/operator-core";
import { X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useOperatorStore } from "../../use-operator-store.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { useElevatedModeUiContext } from "./elevated-mode-provider.js";

export function ElevatedModeChrome() {
  const { core, exitElevatedMode } = useElevatedModeUiContext();
  const elevatedMode = useOperatorStore(core.elevatedModeStore);
  const [busy, setBusy] = useState(false);

  if (!isElevatedModeActive(elevatedMode)) return null;

  return (
    <div
      className="z-40 flex h-8 shrink-0 items-center justify-between border-b border-error/30 bg-error/15 px-3 text-xs font-medium text-error"
      data-testid="elevated-mode-frame"
    >
      <span>Elevated Mode</span>
      <button
        aria-label="Exit Elevated Mode"
        className="flex h-5 w-5 items-center justify-center rounded text-error/70 transition-colors hover:bg-error/15 hover:text-error"
        data-testid="elevated-mode-exit"
        disabled={busy}
        type="button"
        onClick={() => {
          setBusy(true);
          void exitElevatedMode()
            .catch((error) => {
              toast.error(formatErrorMessage(error));
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        <X aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
