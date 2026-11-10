import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Card } from "@/components/ui";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Catches render errors in a page so the shell and navigation stay usable. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ContractSoup page error", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <Card className="mx-auto mt-8 max-w-lg text-center" role="alert">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-high-soft text-high-ink">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="text-lg font-semibold">This page hit a problem</h1>
        <p className="mt-2 text-sm text-muted">
          Nothing was uploaded and your saved audits are safe. Try again, or use the menu to go somewhere else.
        </p>
        <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-left text-xs text-muted break-words">
          {this.state.error.message}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload app
          </Button>
        </div>
      </Card>
    );
  }
}
