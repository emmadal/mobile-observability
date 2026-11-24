import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/** False during server rendering and hydration, true once mounted in the browser. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
