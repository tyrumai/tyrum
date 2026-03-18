import * as React from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Button } from "./button.js";
import { Checkbox } from "./checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";

export interface ConfirmDangerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  confirmationLabel?: React.ReactNode;
  onConfirm: () => void | false | Promise<void | false>;
  isLoading?: boolean;
  confirmDisabled?: boolean;
  children?: React.ReactNode;
}

export function ConfirmDangerDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmationLabel = "I understand and want to proceed.",
  onConfirm,
  isLoading = false,
  confirmDisabled = false,
  children,
}: ConfirmDangerDialogProps): React.ReactElement {
  const [confirmed, setConfirmed] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) return;
    setConfirmed(false);
    setSubmitting(false);
  }, [open]);

  const busy = isLoading || submitting;

  const close = (): void => {
    if (busy) return;
    onOpenChange(false);
  };

  const submit = async (): Promise<void> => {
    if (!confirmed || busy || confirmDisabled) return;
    setSubmitting(true);
    try {
      const result = await onConfirm();
      if (result !== false) onOpenChange(false);
    } catch (error) {
      toast.error("Action failed", { description: formatErrorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpenChange(true);
          return;
        }
        close();
      }}
    >
      <DialogContent
        data-testid="confirm-danger-dialog"
        aria-modal="true"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="mt-4 grid gap-4">
          {children}
          <label className="flex items-center gap-3 text-sm text-fg">
            <Checkbox
              data-testid="confirm-danger-checkbox"
              checked={confirmed}
              disabled={busy}
              onCheckedChange={(nextChecked) => {
                setConfirmed(Boolean(nextChecked));
              }}
            />
            <span>{confirmationLabel}</span>
          </label>
        </div>

        <DialogFooter>
          <Button
            type="button"
            data-testid="confirm-danger-cancel"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              close();
            }}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            data-testid="confirm-danger-confirm"
            variant="danger"
            isLoading={submitting}
            disabled={!confirmed || busy || confirmDisabled}
            onClick={() => {
              void submit();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
