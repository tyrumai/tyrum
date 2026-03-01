import * as React from "react";
import { Button } from "./button.js";
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
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
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
  children,
}: ConfirmDangerDialogProps): React.ReactElement {
  const [confirmed, setConfirmed] = React.useState(false);

  React.useEffect(() => {
    if (open) return;
    setConfirmed(false);
  }, [open]);

  const close = (): void => {
    if (isLoading) return;
    onOpenChange(false);
  };

  const submit = (): void => {
    if (!confirmed || isLoading) return;
    void onConfirm();
    onOpenChange(false);
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
          if (isLoading) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isLoading) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="mt-4 grid gap-4">
          {children}
          <label className="flex items-center gap-3 text-sm text-fg">
            <input
              type="checkbox"
              data-testid="confirm-danger-checkbox"
              checked={confirmed}
              disabled={isLoading}
              onChange={(event) => {
                setConfirmed(event.target.checked);
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
            disabled={isLoading}
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
            disabled={!confirmed || isLoading}
            onClick={() => {
              submit();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

