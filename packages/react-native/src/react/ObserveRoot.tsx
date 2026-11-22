import { type ComponentType, useCallback, useRef } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { getClient } from '../core/singleton';
import { ExpoRouterIntegration } from '../integrations/expo-router';

interface ObserveRootViewProps {
  children: React.ReactNode;
}

function ObserveRootView({ children }: ObserveRootViewProps) {
  const client = getClient();
  const laidOut = useRef(false);

  // Mark mounted during render so configure() afterwards throws, as in expo-observe.
  client.onRootMounted();

  const onLayout = useCallback(
    (_event: LayoutChangeEvent) => {
      if (laidOut.current) return;
      laidOut.current = true;
      client.onRootLayout();
    },
    [client],
  );

  return (
    <View style={styles.root} onLayout={onLayout} collapsable={false}>
      {client.integrationOptions('expo-router') ? <ExpoRouterIntegration /> : null}
      {children}
    </View>
  );
}

function wrap<P extends object>(Component: ComponentType<P>): ComponentType<P> {
  function Observed(props: P) {
    return (
      <ObserveRootView>
        <Component {...props} />
      </ObserveRootView>
    );
  }
  Observed.displayName = `ObserveRoot(${Component.displayName ?? Component.name ?? 'Component'})`;
  return Observed;
}

/** Wrap the root component: measures time to first render and enables integrations. */
export const ObserveRoot = { wrap };

const styles = StyleSheet.create({ root: { flex: 1 } });
