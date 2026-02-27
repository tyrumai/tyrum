import * as React from "react";
import { ErrorFallback } from "./error-fallback.js";

export type ErrorBoundaryFallback = (options: {
  error: unknown;
  resetErrorBoundary: () => void;
}) => React.ReactNode;

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode | ErrorBoundaryFallback;
  onError?: (error: unknown, info: React.ErrorInfo) => void;
  onReloadPage?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: unknown | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }

  resetErrorBoundary = (): void => {
    this.setState({ hasError: false, error: null });
  };

  reloadPage = (): void => {
    this.resetErrorBoundary();

    const reloadHandler = this.props.onReloadPage;
    if (reloadHandler) {
      reloadHandler();
      return;
    }

    if (typeof globalThis.location?.reload === "function") {
      globalThis.location.reload();
    }
  };

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  render(): React.ReactNode {
    const { hasError, error } = this.state;
    if (!hasError) {
      return this.props.children;
    }

    const { fallback } = this.props;
    if (typeof fallback === "function") {
      return fallback({ error, resetErrorBoundary: this.resetErrorBoundary });
    }

    if (fallback) {
      return fallback;
    }

    return React.createElement(ErrorFallback, {
      error,
      onReloadPage: this.reloadPage,
    });
  }
}
