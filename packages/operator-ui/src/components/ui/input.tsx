import * as React from "react";
import { cn } from "../../lib/cn.js";
import { Label } from "./label.js";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  helperText?: React.ReactNode;
  error?: React.ReactNode;
  suffix?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, helperText, error, suffix, id: idProp, required, type = "text", ...props }, ref) => {
    const generatedId = React.useId();
    const id = idProp ?? generatedId;
    const message = error || helperText;
    const describedById = message ? `${id}-help` : undefined;

    return (
      <div className="grid gap-2">
        {label ? (
          <Label htmlFor={id} required={required}>
            {label}
          </Label>
        ) : null}
        <div className="relative">
          <input
            ref={ref}
            id={id}
            type={type}
            required={required}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={describedById}
            className={cn(
              "box-border flex h-9 w-full rounded-md border border-border/80 bg-bg-card/40 backdrop-blur-md px-3 py-1 text-sm text-fg shadow-inner transition-all duration-200",
              "placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent hover:bg-bg-card/60 focus-visible:bg-bg-card/80",
              "disabled:cursor-not-allowed disabled:opacity-50",
              error ? "border-error focus-visible:ring-error" : null,
              suffix ? "pr-10" : null,
              className,
            )}
            {...props}
          />
          {suffix ? (
            <div className="absolute right-0 top-0 flex h-full items-center justify-center px-3 text-fg-muted">
              {suffix}
            </div>
          ) : null}
        </div>
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
