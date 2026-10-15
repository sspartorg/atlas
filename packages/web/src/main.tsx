import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/theme-vars.css';
// Self-hosted Inter, JetBrains Mono and the icon subset (scripts/fetch-fonts.mjs).
import './theme/fonts.css';
import { ThemeModeProvider } from './components/ThemeModeProvider.js';
import { App } from './App.js';
import { initWebVitalsReporter } from './perf/web-vitals.js';
import { installDialogEscapeFix } from './utils/dialogEscape.js';

void initWebVitalsReporter();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

installDialogEscapeFix();

createRoot(rootEl).render(
    <StrictMode>
        <ThemeModeProvider>
            <App />
        </ThemeModeProvider>
    </StrictMode>
);
