import { useContext } from 'react';

type RouteContextModule = { NavigationRouteContext?: React.Context<{ key: string } | undefined> };

// @react-navigation/native is optional (Expo Router depends on it). Metro allows
// unresolved requires inside try/catch.
let routeContext: React.Context<{ key: string } | undefined> | null = null;
try {
  routeContext =
    (require('@react-navigation/native') as RouteContextModule).NavigationRouteContext ?? null;
} catch {
  routeContext = null;
}

const NoRoute = { _currentValue: undefined } as unknown as React.Context<
  { key: string } | undefined
>;

/** Key of the screen this hook runs in, or undefined outside a navigator. */
export function useRouteKey(): string | undefined {
  // Always calls useContext exactly once, keeping hook order stable.
  const route = useContext(routeContext ?? NoRoute);
  return route?.key;
}
