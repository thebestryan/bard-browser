import React from "react";

/**
 * Without this, one thrown render (a bad card, a malformed import, a typo)
 * unmounts the whole app and the user sees a blank page with their data
 * apparently gone. Contain the failure and offer a way back.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Render error:", error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="card" style={{ margin: 24, borderColor: "var(--red)" }}>
        <h3 style={{ marginTop: 0, color: "var(--red)" }}>This view hit an error</h3>
        <div className="faint mb" style={{ lineHeight: 1.5 }}>
          Your data is safe — it stays in this browser. Switch to another section, or reload.
        </div>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "var(--text-dim)", overflowX: "auto" }}>
          {String(error?.message || error)}
        </pre>
        <div className="row mt">
          <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn ghost" onClick={() => location.reload()}>Reload app</button>
        </div>
      </div>
    );
  }
}
