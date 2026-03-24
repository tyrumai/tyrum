import * as React from "react";
import { cn } from "../../lib/cn.js";
import { useTranslateNode } from "../../i18n-helpers.js";

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => {
    const translateNode = useTranslateNode();
    return (
      <label
        ref={ref}
        className={cn("text-sm font-medium leading-none text-fg", className)}
        {...props}
      >
        {translateNode(children)}
        {required ? (
          <span aria-hidden="true" className="ml-1 text-error">
            *
          </span>
        ) : null}
      </label>
    );
  },
);
Label.displayName = "Label";
