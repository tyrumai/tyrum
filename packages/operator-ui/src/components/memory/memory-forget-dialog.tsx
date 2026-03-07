import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";

function preventInteractOutside(event: Event): void {
  event.preventDefault();
}

export interface MemoryForgetDialogProps {
  open: boolean;
  targetId: string | null;
  confirmValue: string;
  busy: boolean;
  errorMessage: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirmValueChange: (value: string) => void;
  onCancel: () => void;
  onConfirmForget: () => void;
}

export function MemoryForgetDialog({
  open,
  targetId,
  confirmValue,
  busy,
  errorMessage,
  onOpenChange,
  onConfirmValueChange,
  onCancel,
  onConfirmForget,
}: MemoryForgetDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onInteractOutside={preventInteractOutside}>
        <DialogHeader>
          <DialogTitle>Forget memory item</DialogTitle>
          <DialogDescription>
            This will permanently delete{" "}
            <span data-testid="memory-forget-target" className="font-mono text-xs">
              {targetId}
            </span>
            . Type <strong>FORGET</strong> to confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4" data-testid="memory-forget-dialog">
          <Input
            data-testid="memory-forget-confirm"
            value={confirmValue}
            onChange={(event) => {
              onConfirmValueChange(event.currentTarget.value);
            }}
            placeholder="Type FORGET"
          />
          {errorMessage ? (
            <div className="mt-2 text-sm text-error" role="alert">
              {errorMessage}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            size="sm"
            data-testid="memory-forget-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            data-testid="memory-forget-submit"
            disabled={busy || confirmValue !== "FORGET"}
            isLoading={busy}
            onClick={onConfirmForget}
          >
            Confirm forget
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
