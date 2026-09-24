import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
// React Flow base styles — imported here (early, top-level) instead of
// only inside the lazy-loaded ScenarioGraphEditor so the canvas always
// has its drag/zoom CSS rules in place by the time the user opens it.
// Without these the .react-flow__node class has no `cursor: grab` and
// no `pointer-events: all`, so node drag silently no-ops.
import '@xyflow/react/dist/style.css';
import { initTheme } from './utils/theme';
import { initNativeBridge } from './native/bridge';

// Apply saved theme immediately to avoid flash of wrong theme
initTheme();

// Obli Android shell glue (docs/obli-mobile.md §3): window.__obliHandleBack
// for the system back button + Escape dispatch for overlays, and system bars
// following the theme. Harmless in a normal browser.
initNativeBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
