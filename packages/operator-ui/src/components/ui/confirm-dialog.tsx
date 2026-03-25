import * as React from "react";
import { toast } from "sonner";
import { translateNode, translateString, useI18n } from "../../i18n-helpers.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Button } from "./button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  cancelLabel?: React.ReactNode;
  onConfirm: () => void | false | Promise<void | false>;
  isLoading?: boolean;
  confirmDisabled?: boolean;
  children?: React.ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  isLoading = false,
  confirmDisabled = false,
  children,
}: ConfirmDialogProps): React.ReactElement {
  const intl = useI18n();
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) return;
    setSubmitting(false);
  }, [open]);

  const busy = isLoading || submitting;

  const close = (): void => {
    if (busy) return;
    onOpenChange(false);
  };

  const submit = async (): Promise<void> => {
    if (busy || confirmDisabled) return;
    setSubmitting(true);
    try {
      const result = await onConfirm();
      if (result !== false) onOpenChange(false);
    } catch (error) {
      toast.error(translateString(intl, "Action failed"), {
        description: formatErrorMessage(error),
      });
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
        data-testid="confirm-dialog"
        aria-modal="true"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{translateNode(intl, title)}</DialogTitle>
          {description ? (
            <DialogDescription>{translateNode(intl, description)}</DialogDescription>
          ) : null}
        </DialogHeader>

        {children ? <div className="mt-4 grid gap-4">{children}</div> : null}

        <DialogFooter>
          <Button
            type="button"
            data-testid="confirm-dialog-cancel"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              close();
            }}
          >
            {translateNode(intl, cancelLabel)}
          </Button>
          <Button
            type="button"
            data-testid="confirm-dialog-confirm"
            variant="primary"
            isLoading={submitting}
            disabled={busy || confirmDisabled}
            onClick={() => {
              void submit();
            }}
          >
            {translateNode(intl, confirmLabel)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
