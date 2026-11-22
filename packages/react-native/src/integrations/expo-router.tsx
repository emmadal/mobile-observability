import { useEffect } from 'react';
import { getClient } from '../core/singleton';
import type { NavigationRefLike } from '../performance/navigation';

type ExpoRouterModule = { useNavigationContainerRef?: () => NavigationRefLike };

let expoRouter: ExpoRouterModule | null = null;
try {
  expoRouter = require('expo-router') as ExpoRouterModule;
} catch {
  expoRouter = null;
}

const useContainerRef: () => NavigationRefLike | null =
  expoRouter?.useNavigationContainerRef ?? (() => null);

/** Rendered inside ObserveRoot when `integrations: { 'expo-router': true }`. */
export function ExpoRouterIntegration() {
  const ref = useContainerRef();
  useEffect(() => {
    if (!ref) return undefined;
    return getClient().attachNavigation(ref, 'expo-router');
  }, [ref]);
  return null;
}
