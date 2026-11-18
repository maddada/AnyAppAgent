import { Component, type ReactNode } from 'react';

/** "Something went wrong" with a Reload button instead of a blank page. Leave it in main.tsx. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page">
        <div className="card notice">
          <p className="body-strong">Something went wrong</p>
          <p className="small muted">The app hit a problem. Reload to start it again; your saved things are kept.</p>
          <div className="actions">
            <button type="button" className="button" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </main>
    );
  }
}
