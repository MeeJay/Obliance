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

// Apply saved theme immediately to avoid flash of wrong theme
initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
