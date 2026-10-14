import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/theme-vars.css';
import { ThemeModeProvider } from './components/ThemeModeProvider.js';
import { App } from './App.js';
import { initWebVitalsReporter } from './perf/web-vitals.js';
import { ICON_FONT_URL } from './theme/icons.js';

void initWebVitalsReporter();

// The icon font, subset to the glyphs the app uses (see theme/icons.ts).
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = ICON_FONT_URL;
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
