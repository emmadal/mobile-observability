import { Component, type ErrorInfo, type ReactNode } from 'react';
import { getClient } from '../core/singleton';

export interface ObserveErrorBoundaryProps {
  children: ReactNode;
  /** Rendered after an error; receives the error and a reset callback. */
  fallback?: ReactNode | ((props: { error: unknown; resetError: () => void }) => ReactNode);
  onError?: (error: unknown, componentStack: string | undefined) => void;
}

interface State {
  error: unknown;
}

/** Reports render errors (with the component stack as a tag) and shows a fallback. */
export class ObserveErrorBoundary extends Component<ObserveErrorBoundaryProps, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const componentStack = info.componentStack ?? undefined;
    getClient().captureError(error, {
      handled: true,
      ...(componentStack ? { tags: { componentStack: componentStack.trim().slice(0, 250) } } : {}),
    });
    this.props.onError?.(error, componentStack);
  }

  private readonly resetError = () => this.setState({ error: null });

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    const { fallback } = this.props;
    if (typeof fallback === 'function')
      return fallback({ error: this.state.error, resetError: this.resetError });
    return fallback ?? null;
  }
}
