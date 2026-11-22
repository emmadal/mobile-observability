import { useCallback } from 'react';
import { getClient } from '../core/singleton';
import type { MarkInteractiveOptions } from '../types';
import { useRouteKey } from './route-key';

export interface UseObserveResult {
  /** Records time to interactive: app-level on the first call, and for this screen when inside one. */
  markInteractive: (options?: MarkInteractiveOptions) => void;
}

export function useObserve(): UseObserveResult {
  const routeKey = useRouteKey();
  const markInteractive = useCallback(
    (options?: MarkInteractiveOptions) => getClient().markInteractive(options, routeKey),
    [routeKey],
  );
  return { markInteractive };
}
