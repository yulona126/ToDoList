import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './i18n';
import { queryClient } from './lib/queryClient';
import { AuthProvider } from './stores/AuthContext';
import { UIProvider } from './stores/UIContext';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root is missing from index.html');
}

/**
 * Provider order matters:
 *   BrowserRouter → QueryClientProvider → UIProvider (theme/lang/toasts) →
 *   AuthProvider (needs router navigation for the 401 handler) → App.
 */
createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <UIProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </UIProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);
