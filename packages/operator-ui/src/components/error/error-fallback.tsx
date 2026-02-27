import * as React from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "../ui/button.js";

export interface ErrorFallbackProps {
  error: unknown;
  onReloadPage: () => void;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return String(error);
}

export function ErrorFallback({ error, onReloadPage }: ErrorFallbackProps) {
  const message = formatErrorMessage(error);

  return (
    <div role="alert" className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-lg border border-error/30 bg-error/10 p-6 text-fg">
        <div className="flex gap-3">
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-6 w-6 shrink-0 text-error" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">Something went wrong</div>
            <div className="mt-2 break-words text-sm text-fg-muted">{message}</div>
            <div className="mt-4">
              <Button variant="outline" onClick={onReloadPage}>
                Reload Page
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
