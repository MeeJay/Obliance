import { useState, useEffect } from 'react';

/**
 * Returns the top offset (in px) injected by the ObliTools native desktop
 * launcher.  ObliTools sets `margin-top` on `#root` to push flow content
 * below its fixed tab-bar.  Fixed-position overlays (remote viewers, toasts)
 * need this value so they don't render behind the bar.
 *
 * Returns 0 when not running inside ObliTools.
 */
export function useNativeTopOffset(): number {
  const [offset, setOffset] = useState(() => readOffset());

  useEffect(() => {
    // Re-measure on resize (the bar might not exist on first paint).
    const measure = () => setOffset(readOffset());
    window.addEventListener('resize', measure);
    // Also observe DOM changes in case the bar is injected after mount.
    const mo = new MutationObserver(measure);
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    // Initial re-measure after a tick (bar might be injected async).
    const t = setTimeout(measure, 100);
    return () => {
      window.removeEventListener('resize', measure);
      mo.disconnect();
      clearTimeout(t);
    };
  }, []);

  return offset;
}

function readOffset(): number {
  const root = document.getElementById('root');
  if (!root) return 0;
  return parseInt(getComputedStyle(root).marginTop, 10) || 0;
}
