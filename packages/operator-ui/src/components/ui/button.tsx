import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import { cn } from "../../lib/cn.js";
import { Spinner } from "./spinner.js";

export type ButtonVariant = "primary" | "success" | "secondary" | "danger" | "ghost" | "outline";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  asChild?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary/90",
  success: "bg-success text-white hover:bg-success/90",
  secondary: "bg-bg-card text-fg border border-border hover:bg-bg-subtle",
  danger: "bg-error text-white hover:bg-error/90",
  ghost: "bg-transparent text-fg hover:bg-primary-dim",
  outline: "bg-transparent text-fg border border-border hover:bg-bg-subtle",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-10 px-5 text-base",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      asChild = false,
      isLoading = false,
      disabled,
      children,
      type,
      ...props
    },
    ref,
  ) => {
    const Component: React.ElementType = asChild ? Slot : "button";
    const isDisabled = Boolean(disabled) || isLoading;
    const resolvedType = asChild ? type : (type ?? "button");

    let content: React.ReactNode;
    if (asChild) {
      if (isLoading) {
        const onlyChild = React.Children.only(children) as React.ReactElement<{
          children?: React.ReactNode;
        }>;
        content = React.cloneElement(onlyChild, undefined, [
          React.createElement(Spinner, { key: "spinner", "aria-hidden": true }),
          onlyChild.props.children,
        ]);
      } else {
        content = children;
      }
    } else {
      content = React.createElement(
        React.Fragment,
        null,
        isLoading ? React.createElement(Spinner, { "aria-hidden": true }) : null,
        children,
      );
    }

    return (
      <Component
        ref={ref}
        type={resolvedType}
        disabled={isDisabled}
        aria-busy={isLoading || undefined}
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          "disabled:pointer-events-none disabled:opacity-50",
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className,
        )}
        {...props}
      >
        {content}
      </Component>
    );
  },
);
Button.displayName = "Button";
