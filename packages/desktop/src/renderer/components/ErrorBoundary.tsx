import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors anywhere in the tree (e.g. BlockNote parsing, a
 * thrown IPC promise surfaced during render) so a single failure shows a
 * recoverable message instead of blanking the whole app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[docvault] render error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm font-medium text-neutral-700">Something went wrong.</p>
          <p className="max-w-md text-xs text-neutral-400">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-md border border-[var(--dv-border)] bg-white px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            Dismiss
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
