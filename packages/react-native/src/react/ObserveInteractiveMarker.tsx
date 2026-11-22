import { useEffect, useRef } from 'react';
import type { JsonObject } from '../types';
import { useObserve } from './useObserve';

export interface ObserveInteractiveMarkerProps {
  params?: JsonObject;
  routeName?: string;
}

/** Renders nothing; calls markInteractive() once when mounted. Later prop changes are ignored. */
export function ObserveInteractiveMarker({ params, routeName }: ObserveInteractiveMarkerProps) {
  const { markInteractive } = useObserve();
  const initial = useRef({ params, routeName });

  useEffect(() => {
    const { params: firstParams, routeName: firstRouteName } = initial.current;
    markInteractive({
      ...(firstParams ? { params: firstParams } : {}),
      ...(firstRouteName ? { routeName: firstRouteName } : {}),
    });
  }, [markInteractive]);

  return null;
}
