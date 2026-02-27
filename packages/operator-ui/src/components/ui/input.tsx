import * as React from "react";
import { cn } from "../../lib/cn.js";
import { Label } from "./label.js";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  helperText?: React.ReactNode;
  error?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, helperText, error, id: idProp, required, type = "text", ...props }, ref) => {
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
        <input
          ref={ref}
          id={id}
          type={type}
          required={required}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={describedById}
          className={cn(
            "flex h-9 w-full rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg shadow-sm transition-colors",
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
Input.displayName = "Input";
