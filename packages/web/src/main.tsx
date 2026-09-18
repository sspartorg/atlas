import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/theme-vars.css';
import { ThemeModeProvider } from './components/ThemeModeProvider.js';
import { App } from './App.js';
import { initWebVitalsReporter } from './perf/web-vitals.js';

void initWebVitalsReporter();

// Only FILL varies in the app (0/1); the other axes stay at the font's
// defaults. Requesting their full ranges made current Chrome download the
// whole 5.2 MB variable font instead of ~0.5 MB.
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0';
document.head.appendChild(link);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

createRoot(rootEl).render(
    <StrictMode>
        <ThemeModeProvider>
            <App />
        </ThemeModeProvider>
    </StrictMode>
);
