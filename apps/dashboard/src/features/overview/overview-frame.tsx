'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useRef,
  useTransition,
} from 'react';
import { cn } from '@/lib/utils';
import { type OverviewFilters, refreshMs, toSearchParams } from './filters';

interface OverviewNavigation {
  filters: OverviewFilters;
  /** Apply a change to the filters (a URL navigation, so the server re-renders). */
  update: (change: Partial<OverviewFilters>) => void;
  /** Re-run the server render for the current filters. */
  refresh: () => void;
  isPending: boolean;
}

const OverviewContext = createContext<OverviewNavigation | null>(null);

export function useOverviewNavigation(): OverviewNavigation {
  const context = use(OverviewContext);
  if (!context) throw new Error('useOverviewNavigation must be used inside <OverviewFrame>');
  return context;
}

/**
 * Holds the filters the server rendered with and turns changes into URL
 * navigations. While a navigation or refresh runs, the previous render stays
 * in place at reduced opacity: no skeleton, no layout jump.
 */
export function OverviewFrame({
  filters,
  toolbar,
  children,
}: {
  filters: OverviewFilters;
  toolbar: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const update = useCallback(
    (change: Partial<OverviewFilters>) => {
      const query = toSearchParams({ ...filters, ...change }).toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [filters, pathname, router],
  );

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  useAutoRefresh(refreshMs(filters.refresh), refresh);

  return (
    <OverviewContext value={{ filters, update, refresh, isPending }}>
      {toolbar}
      <div
        aria-busy={isPending}
        className={cn('transition-opacity duration-200', isPending && 'opacity-60')}
      >
        {children}
      </div>
    </OverviewContext>
  );
}

/**
 * Calls `refresh` every `intervalMs` while the tab is visible. A hidden tab
 * skips its ticks and catches up once when it becomes visible again.
 */
function useAutoRefresh(intervalMs: number, refresh: () => void) {
  const lastRun = useRef(Date.now());

  useEffect(() => {
    if (intervalMs <= 0) return;
    lastRun.current = Date.now();

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      lastRun.current = Date.now();
      refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRun.current >= intervalMs) {
        tick();
      }
    };

    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, refresh]);
}
