import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { DesktopUpdateBanner } from './DesktopUpdateBanner';
import { LiveAlerts } from './LiveAlerts';
import { GlobalAddAgentModal } from './GlobalAddAgentModal';
import { GlobalChatPanel } from './GlobalChatPanel';
import { GlobalShellPanel } from './GlobalShellPanel';
import { useUiStore } from '@/store/uiStore';
import { useSocket } from '@/hooks/useSocket';
import { cn } from '@/utils/cn';

export function AppLayout() {
  // Global socket subscriptions — always active regardless of which page is open
  useSocket();

  const { sidebarOpen, sidebarWidth, setSidebarWidth, sidebarFloating, sidebarCollapsed } = useUiStore();
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // ── Body-row top offset ────────────────────────────────────────────────────
  // The floating sidebar is `position: fixed` and must drop down from BELOW
  // the topbar — not from y=0. We measure where the body row (header excluded)
  // actually starts and use that as the floating sidebar's top anchor. This
  // also handles the native desktop app's tab bar (added as body padding-top).
  const bodyRowRef = useRef<HTMLDivElement>(null);
  const [topOffset, setTopOffset] = useState(0);

  useEffect(() => {
    const measure = () => {
      if (bodyRowRef.current) {
        setTopOffset(bodyRowRef.current.getBoundingClientRect().top);
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
    <div className="flex h-screen flex-col overflow-hidden bg-bg-primary">

      {/* Full-width topbar — always on top of the sidebar so logo + tenant
          selector stay visible regardless of sidebar state (collapsed,
          floating, hidden). Spec: D:\Mockup\obli-design-system.md §4 +
          obliance_redesign_proposal.html. */}
      <Header />
      <DesktopUpdateBanner />

      {/* Body row — sidebar + main content side by side, below the topbar */}
      <div ref={bodyRowRef} className="flex flex-1 overflow-hidden">

        {sidebarFloating ? (
          <>
            {/* Invisible hover-trigger strip on the far left edge of the body
                row (excludes the topbar so the user can still click logo /
                tenant when the sidebar is auto-hidden). */}
            <div
              className="fixed left-0 z-[51]"
              style={{ top: topOffset, height: `calc(100% - ${topOffset}px)`, width: '8px' }}
              onMouseEnter={showFloat}
            />

            {/* Floating sidebar panel — slides in from left on hover, anchored
                to the body row top so it never overlaps the topbar. */}
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
            style={sidebarOpen
              ? { width: sidebarCollapsed ? '64px' : `${sidebarWidth}px` }
              : undefined}
          >
            <Sidebar />

            {/* Resize handle — disabled while collapsed (fixed 64 px width). */}
            {sidebarOpen && !sidebarCollapsed && (
              <div
                onMouseDown={handleMouseDown}
                className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 active:bg-accent/50 transition-colors z-10"
              />
            )}
          </div>
        )}

        {/* Main content */}
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
      <GlobalShellPanel />
    </div>
  );
}
