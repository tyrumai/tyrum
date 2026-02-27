import * as React from "react";
import { cn } from "../../lib/cn.js";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  width?: number | string;
  height?: number | string;
}

export function Skeleton({ className, width, height, style, ...props }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded bg-bg-subtle", className)}
      style={{ ...style, width, height }}
      {...props}
    />
  );
}
