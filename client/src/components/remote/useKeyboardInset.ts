import { useEffect, useState } from 'react';

/**
 * Height (px) of the part of the layout viewport hidden by the on-screen
 * keyboard, from `window.visualViewport`. 0 on desktop and wherever the
 * keyboard already resizes the layout viewport (index.html asks Chrome for
 * `interactive-widget=resizes-content`); non-zero on browsers that only
 * shrink the visual viewport (iOS Safari…). Full-screen remote overlays use
 * it as their bottom offset so the key bar stays above the keyboard.
 */
export function useKeyboardInset(active = true): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const hidden = window.innerHeight - vv.height - vv.offsetTop;
        // Ignore sub-pixel noise and pinch-zoom (scale != 1 shrinks vv too).
        setInset(vv.scale > 1.01 || hidden < 1 ? 0 : Math.round(hidden));
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);

  return active ? inset : 0;
}
