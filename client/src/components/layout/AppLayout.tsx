import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { DesktopUpdateBanner } from './DesktopUpdateBanner';
import { LiveAlerts } from './LiveAlerts';
import { GlobalAddAgentModal } from './GlobalAddAgentModal';
import { GlobalChatPanel } from './GlobalChatPanel';
import { useUiStore } from '@/store/uiStore';
import { useSocket } from '@/hooks/useSocket';
import { cn } from '@/utils/cn';

export function AppLayout() {
  // Global socket subscriptions — always active regardless of which page is open
  useSocket();

  const { sidebarOpen, sidebarWidth, setSidebarWidth, sidebarFloating } = useUiStore();
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // ── Native desktop app top offset ─────────────────────────────────────────
  // When the native desktop app overlays its tab bar over the webview, it adds
  // padding-top to the body so flow-content (like the Header) sits below the
  // tab bar.  Fixed-position elements ignore that padding and would start at
  // y=0 (behind the tab bar).  We measure where the main content div actually
  // starts and use that as the top offset for the floating sidebar.
  const mainContentRef = useRef<HTMLDivElement>(null);
  const [topOffset, setTopOffset] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (mainContentRef.current) {
        setTopOffset(mainContentRef.current.getBoundingClientRect().top);
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // ── Floating sidebar visibility ───────────────────────────────────────────
  const [floatVisible, setFloatVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset floating visibility whenever the mode is toggled off
  useEffect(() => {
    if (!sidebarFloating) setFloatVisible(false);
  }, [sidebarFloating]);

  const showFloat = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setFloatVisible(true);
  }, []);

  const hideFloat = useCallback(() => {
    hideTimer.current = setTimeout(() => setFloatVisible(false), 150);
  }, []);

  // ── Resize handle ─────────────────────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = sidebarWidth;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = ev.clientX - startX.current;
        setSidebarWidth(startWidth.current + delta);
      };

      const handleMouseUp = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [sidebarWidth, setSidebarWidth],
  );

  return (
    <div className="flex h-screen overflow-hidden bg-bg-primary">

      {sidebarFloating ? (
        <>
          {/* Invisible hover-trigger strip on the far left edge of the viewport.
              Wide enough to be comfortable (8 px) but visually imperceptible.
              Starts below the native desktop app tab bar (topOffset). */}
          <div
            className="fixed left-0 z-[51]"
            style={{ top: topOffset, height: `calc(100% - ${topOffset}px)`, width: '8px' }}
            onMouseEnter={showFloat}
          />

          {/* Floating sidebar panel — slides in from left on hover.
              top/height adjusted so it never overlaps the native tab bar. */}
          <div
            className={cn(
              'fixed left-0 z-50',
              'transition-transform duration-200 ease-in-out',
              'shadow-[4px_0_24px_0_rgba(0,0,0,0.35)]',
              floatVisible ? 'translate-x-0' : '-translate-x-full',
            )}
            style={{ width: `${sidebarWidth}px`, top: topOffset, height: `calc(100% - ${topOffset}px)` }}
            onMouseEnter={showFloat}
            onMouseLeave={hideFloat}
          >
            <Sidebar />

            {/* Resize handle — still usable in floating mode */}
            <div
              onMouseDown={handleMouseDown}
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 active:bg-accent/50 transition-colors z-10"
            />
          </div>
        </>
      ) : (
        /* ── Normal pinned sidebar ── */
        <div
          className={cn(
            'flex-shrink-0 transition-all duration-200 relative',
            !sidebarOpen && 'w-0 overflow-hidden',
          )}
          style={sidebarOpen ? { width: `${sidebarWidth}px` } : undefined}
        >
          <Sidebar />

          {/* Resize handle */}
          {sidebarOpen && (
            <div
              onMouseDown={handleMouseDown}
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 active:bg-accent/50 transition-colors z-10"
            />
          )}
        </div>
      )}

      {/* Main content */}
      <div ref={mainContentRef} className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <DesktopUpdateBanner />
        <main className="flex-1 overflow-y-auto flex flex-col">
          <Outlet />
        </main>
      </div>

      {/* Live alert toasts */}
      <LiveAlerts />

      {/* Global Add Agent modal (triggered from sidebar / dashboard) */}
      <GlobalAddAgentModal />

      {/* Global persistent chat (multi-tab, survives page navigation) */}
      <GlobalChatPanel />
    </div>
  );
}
