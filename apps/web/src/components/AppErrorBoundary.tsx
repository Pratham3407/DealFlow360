/**
 * Last line of defence against a blank page.
 *
 * When a render throws, React unmounts the whole tree and the document is simply
 * empty — no message, nothing in the UI to act on, and in development an HMR
 * update that happens to be mid-edit leaves the tab dead until a full reload.
 * Catching here keeps something on screen and says what to do about it.
 *
 * This is a class component because `componentDidCatch` has no hook equivalent.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the component stack: it is the only clue to which screen failed.
    this.setState({ info: info.componentStack ?? null });
    console.error('Unhandled render error', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="login-page">
        <div className="login-card" style={{ maxWidth: 520 }} role="alert">
          <h1 style={{ marginBottom: 10 }}>Something broke</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            This screen failed to render. Reloading usually clears it; if it happens
            again the message below is the useful part.
          </p>

          <div className="error" style={{ marginTop: 14 }}>
            <strong>{error.name}</strong> — {error.message}
          </div>

          {info && (
            <details style={{ marginTop: 4 }}>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>
                Component stack
              </summary>
              <pre
                className="mono"
                style={{
                  marginTop: 8,
                  padding: 10,
                  maxHeight: 220,
                  overflow: 'auto',
                  fontSize: 11,
                  lineHeight: 1.6,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-sm)',
                  color: 'var(--muted)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {info.trim()}
              </pre>
            </details>
          )}

          <div className="row" style={{ gap: 8, marginTop: 16 }}>
            <button onClick={() => window.location.reload()}>Reload</button>
            <button
              className="btn secondary"
              onClick={() => {
                window.location.assign('/');
              }}
            >
              Go to start
            </button>
          </div>
        </div>
      </div>
    );
  }
}
