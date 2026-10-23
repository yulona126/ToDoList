import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { InstallPrompt } from '../pwa/InstallPrompt';
import { OfflineNotice, UpdatePrompt } from '../pwa/UpdatePrompt';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * App shell — design-system §4:
 *   [Sidebar 240px] [Topbar + fluid content, small gutters]
 * Below 768px the sidebar becomes a drawer.
 *
 * The shell owns the viewport (`h-dvh overflow-hidden`) and the content column
 * scrolls on its own, so the sidebar never scrolls away on long task boards.
 */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  /* Navigating away always closes the mobile drawer. */
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      <Sidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenSidebar={() => setDrawerOpen(true)} />

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="w-full px-3 py-3 md:px-4 md:py-4">
            <OfflineNotice />
            <UpdatePrompt />
            <InstallPrompt />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
