import * as React from "react";
import { cn } from "../../lib/cn.js";
import { Label } from "./label.js";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: React.ReactNode;
  helperText?: React.ReactNode;
  error?: React.ReactNode;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, helperText, error, id: idProp, required, ...props }, ref) => {
    const generatedId = React.useId();
    const id = idProp ?? generatedId;
    const describedById = helperText || error ? `${id}-help` : undefined;
    const message = error ?? helperText;

    return (
      <div className="grid gap-2">
        {label ? (
          <Label htmlFor={id} required={required}>
            {label}
          </Label>
        ) : null}
        <textarea
          ref={ref}
          id={id}
          required={required}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={describedById}
          className={cn(
            "flex min-h-20 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg shadow-sm transition-colors",
            "placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error ? "border-error focus-visible:ring-error" : null,
            className,
          )}
          {...props}
        />
        {message ? (
          <p id={describedById} className={cn("text-sm", error ? "text-error" : "text-fg-muted")}>
            {message}
          </p>
        ) : null}
      </div>
    );
  },
);
Textarea.displayName = "Textarea";
