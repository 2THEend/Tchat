import { Component, ReactNode, ErrorInfo } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Tchat ErrorBoundary caught an unhandled error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div 
          id="tchat-error-boundary"
          className="min-h-screen bg-stone-950 text-stone-200 flex flex-col items-center justify-center p-6 text-center"
        >
          <div className="w-12 h-12 rounded-2xl bg-rose-950/40 border border-rose-800/30 flex items-center justify-center mb-4 text-rose-400">
            <AlertCircle className="w-6 h-6" />
          </div>

          <h1 className="text-xl font-semibold tracking-tight text-stone-100 mb-2">
            Something unexpected occurred
          </h1>
          
          <p className="text-sm text-stone-400 max-w-sm mb-6 leading-relaxed">
            Tchat encountered an issue while rendering. You can try refreshing the application shell.
          </p>

          <button
            id="error-reset-button"
            type="button"
            onClick={this.handleReset}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-sm font-medium transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Reload Application</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
