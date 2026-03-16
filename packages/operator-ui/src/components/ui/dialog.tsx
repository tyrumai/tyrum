import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/cn.js";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  DialogPrimitive.DialogOverlayProps
>(({ className, ...props }, ref) => {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      data-dialog-overlay=""
      className={cn(
        "fixed inset-0 z-50 bg-black/45",
        "data-[state=open]:tyrum-animate-fade-in data-[state=closed]:tyrum-animate-fade-out",
        className,
      )}
      {...props}
    />
  );
});
DialogOverlay.displayName = "DialogOverlay";

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogPrimitive.DialogContentProps
>(({ className, children, ...props }, ref) => {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2",
          "max-h-[calc(100dvh-2rem)] overflow-y-auto",
          "rounded-lg border border-border bg-bg-card p-4 text-fg shadow-md",
          "data-[state=open]:tyrum-animate-dialog-in data-[state=closed]:tyrum-animate-dialog-out",
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Close
          aria-label="Close"
          className={cn(
            "sticky top-0 z-10 float-right rounded-md p-1 text-fg-muted opacity-70 transition-opacity hover:opacity-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          )}
        >
          <X aria-hidden="true" className="h-4 w-4" />
          <VisuallyHidden.Root>Close</VisuallyHidden.Root>
        </DialogPrimitive.Close>
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = "DialogContent";

export interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}
export function DialogHeader({ className, ...props }: DialogHeaderProps): React.ReactElement {
  return <div className={cn("flex flex-col gap-1", className)} {...props} />;
}

export interface DialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {}
export function DialogFooter({ className, ...props }: DialogFooterProps): React.ReactElement {
  return (
    <div
      className={cn("mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  DialogPrimitive.DialogTitleProps
>(({ className, ...props }, ref) => {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn("text-lg font-semibold leading-none tracking-tight text-fg", className)}
      {...props}
    />
  );
});
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  DialogPrimitive.DialogDescriptionProps
>(({ className, ...props }, ref) => {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("text-sm text-fg-muted", className)}
      {...props}
    />
  );
});
DialogDescription.displayName = "DialogDescription";
