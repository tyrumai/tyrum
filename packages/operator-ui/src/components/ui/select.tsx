import * as React from "react";
import { cn } from "../../lib/cn.js";
import { Label } from "./label.js";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Render only the styled `<select>` without wrapper, label, or helper text. */
  bare?: boolean;
  label?: React.ReactNode;
  helperText?: React.ReactNode;
  error?: React.ReactNode;
}

const SELECT_CLASSES = [
  "box-border flex h-8 w-full rounded-lg border border-border bg-bg px-2.5 py-1 text-sm text-fg transition-[border-color,box-shadow] duration-150",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
  "disabled:cursor-not-allowed disabled:opacity-50",
] as const;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    { className, bare = false, label, helperText, error, id: idProp, required, children, ...props },
    ref,
  ) => {
    const generatedId = React.useId();
    const id = idProp ?? generatedId;
    const message = error || helperText;
    const describedById = message ? `${id}-help` : undefined;

    const selectElement = (
      <select
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedById}
        className={cn(
          ...SELECT_CLASSES,
          error ? "border-error focus-visible:ring-error" : null,
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );

    if (bare) return selectElement;

    return (
      <div className="grid gap-1.5">
        {label ? (
          <Label htmlFor={id} required={required}>
            {label}
          </Label>
        ) : null}
        {selectElement}
        {message ? (
          <div id={describedById} className={cn("text-sm", error ? "text-error" : "text-fg-muted")}>
            {message}
          </div>
        ) : null}
      </div>
    );
  },
);
Select.displayName = "Select";
