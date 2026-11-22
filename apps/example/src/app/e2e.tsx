import { Observe, ObserveTesting } from '@mobile-observability/react-native';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

/**
 * Deep-link driven actions for automated end-to-end runs, e.g.
 *   xcrun simctl openurl booted "obsexample://e2e?action=js-fatal"
 */
function checkoutTotal(cart?: { items: { price: number }[] }): number {
  return (cart as { items: { price: number }[] }).items.reduce((sum, item) => sum + item.price, 0);
}

const actions: Record<string, () => void | Promise<void>> = {
  'js-error': () => {
    Observe.reportError(new Error('E2E handled error'), { tags: { source: 'e2e' } });
  },
  'promise-rejection': () => {
    void Promise.reject(new Error('E2E unhandled rejection'));
  },
  'js-fatal': () => {
    checkoutTotal(undefined);
  },
  'native-signal': () => ObserveTesting.triggerNativeCrash('signal'),
  'native-exception': () => ObserveTesting.triggerNativeCrash('exception'),
  requests: async () => {
    await Promise.allSettled([
      fetch('https://jsonplaceholder.typicode.com/posts/1'),
      fetch('https://jsonplaceholder.typicode.com/posts/999999/missing'),
      fetch('https://unreachable.invalid/orders/42'),
    ]);
  },
  event: () =>
    Observe.logEvent('e2e.completed', { attributes: { run: 1 }, displayName: 'E2E completed' }),
};

export default function E2E() {
  const { action } = useLocalSearchParams<{ action?: string }>();
  const [status, setStatus] = useState('pending');

  useEffect(() => {
    const run = actions[action ?? ''];
    if (!run) {
      setStatus(`unknown action ${action}`);
      return;
    }
    // Let navigation metrics record before acting.
    const timer = setTimeout(async () => {
      if (action === 'js-fatal') {
        run();
        return;
      }
      await run();
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await Observe.dispatchEvents();
      setStatus(`done ${action}`);
    }, 500);
    return () => clearTimeout(timer);
  }, [action]);

  return (
    <View style={{ padding: 16 }}>
      <Text testID="e2e-status">{status}</Text>
    </View>
  );
}
