import { ErrorBoundary } from './components/common/ErrorBoundary';
import { AppShell } from './components/shell/AppShell';

export default function App() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}

