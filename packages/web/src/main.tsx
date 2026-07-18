import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/theme-vars.css';
import { ThemeModeProvider } from './components/ThemeModeProvider.js';
import { App } from './App.js';
import { initWebVitalsReporter } from './perf/web-vitals.js';

void initWebVitalsReporter();

const link = document.createElement('link');
link.rel = 'stylesheet';
link.href =
    'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200';
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
