import { isElevatedModeActive } from "@tyrum/operator-core";
import { X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useOperatorStore } from "../../use-operator-store.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Button } from "../ui/button.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip.js";
import { useElevatedModeUiContext } from "./elevated-mode-provider.js";

export function ElevatedModeChrome() {
  const { core, exitElevatedMode } = useElevatedModeUiContext();
  const elevatedMode = useOperatorStore(core.elevatedModeStore);
  const [busy, setBusy] = useState(false);

  if (!isElevatedModeActive(elevatedMode)) return null;

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-40 border-4 border-error shadow-[inset_0_0_0_1px_rgba(127,29,29,0.35)]"
        data-testid="elevated-mode-frame"
      />
      <div className="absolute right-3 top-3 z-50 md:right-4 md:top-4">
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Exit Elevated Mode"
                className="h-8 w-8 rounded-full border border-error/40 bg-bg-card/90 p-0 text-error backdrop-blur hover:bg-error/10"
                data-testid="elevated-mode-exit"
                disabled={busy}
                variant="ghost"
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
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Exit Elevated Mode</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </>
  );
}
