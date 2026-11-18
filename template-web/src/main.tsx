// Entry point: leave it. The app itself starts in App.tsx.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { registerServiceWorker } from './lib/updates';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

registerServiceWorker();
