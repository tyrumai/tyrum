import * as React from "react";
import { ErrorFallback } from "./error-fallback.js";

export type ErrorBoundaryFallback = (options: {
  error: unknown;
  resetErrorBoundary: () => void;
}) => React.ReactNode;

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode | ErrorBoundaryFallback;
}

interface ErrorBoundaryState {
  error: unknown | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  resetErrorBoundary = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) {
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
      onReloadPage: this.resetErrorBoundary,
    });
  }
}

