import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ThemeProvider, applyStoredTheme } from './theme.js';
import './styles.css';

// Before the first paint, so a dark-mode user never sees a white flash.
applyStoredTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
