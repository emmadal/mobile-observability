import {
  NavigationContainer,
  type NavigationContainerRef,
  useNavigationContainerRef,
} from '@react-navigation/native';
import {
  type ComponentProps,
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
} from 'react';
import { getClient } from '../core/singleton';
import type { NavigationRefLike } from '../performance/navigation';

type ContainerProps = ComponentProps<typeof NavigationContainer>;

function useTrack(ref: NavigationRefLike | null) {
  useEffect(() => {
    if (!ref) return undefined;
    return getClient().attachNavigation(ref, 'react-navigation');
  }, [ref]);
}

/** Drop-in replacement for NavigationContainer that records per-screen metrics. */
export const ObserveNavigationContainer = forwardRef<
  NavigationContainerRef<ReactNavigation.RootParamList>,
  ContainerProps
>(function ObserveNavigationContainer(props, forwardedRef) {
  const ref = useNavigationContainerRef<ReactNavigation.RootParamList>();
  useImperativeHandle(forwardedRef, () => ref, [ref]);
  useTrack(ref as unknown as NavigationRefLike);
  return <NavigationContainer {...props} ref={ref} />;
});

export interface ObserveNavigationProviderProps {
  navigationRef: NavigationContainerRef<ReactNavigation.RootParamList>;
  children: ReactNode;
}

/** For static configuration: pass the same ref to `<Navigation ref>` and this provider. */
export function ObserveNavigationProvider({
  navigationRef,
  children,
}: ObserveNavigationProviderProps) {
  useTrack(navigationRef as unknown as NavigationRefLike);
  return <>{children}</>;
}
