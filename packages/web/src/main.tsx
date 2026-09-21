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
//
// `display=block` is load-bearing, not a tweak. Without it the face resolves
// to `font-display: auto`, and during the swap period every icon paints as its
// raw ligature text — a cold load showed the sidenav as "dashboard",
// "sticky_note_2", "smart_toy" overlapping the real labels. `block` keeps the
// glyph box blank until the font arrives. Never use `swap` on an icon font;
// it is correct for the Inter / JetBrains Mono text faces in index.html.
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href =
    'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0&display=block';
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
