import { Observe, ObserveTesting, useObserve } from '@mobile-observability/react-native';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '../components/ActionButton';

function computeCartTotal(cart: { items?: { price: number }[] } | undefined): number {
  // Deliberate bug for the demo: `cart` can be undefined.
  return (cart as { items: { price: number }[] }).items.reduce(
    (total, item) => total + item.price,
    0,
  );
}

export default function Home() {
  const { markInteractive } = useObserve();
  const [status, setStatus] = useState('Loading…');

  useEffect(() => {
    let cancelled = false;
    fetch('https://jsonplaceholder.typicode.com/todos/1')
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        setStatus('Ready');
        markInteractive({ params: { screen: 'home' } });
      });
    return () => {
      cancelled = true;
    };
  }, [markInteractive]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.status} testID="status">
        {status} · session {Observe.getSessionId()?.slice(0, 8) ?? 'n/a'}
      </Text>

      <Text style={styles.section}>Navigation</Text>
      <View style={styles.group}>
        <Link href="/products" asChild>
          <ActionButton label="Products (screen metrics)" onPress={() => {}} />
        </Link>
        <Link href="/slow" asChild>
          <ActionButton label="Slow screen" onPress={() => {}} />
        </Link>
      </View>

      <Text style={styles.section}>Errors</Text>
      <View style={styles.group}>
        <ActionButton
          label="Report handled error"
          onPress={() =>
            Observe.reportError(new Error('Coupon service returned an empty body'), {
              tags: { feature: 'coupons' },
            })
          }
        />
        <ActionButton
          label="Unhandled promise rejection"
          onPress={() => {
            void Promise.reject(new Error('Payment API timeout'));
          }}
        />
        <ActionButton
          label="Fatal JS error"
          tone="danger"
          testID="js-fatal"
          onPress={() => computeCartTotal(undefined)}
        />
        <ActionButton
          label="Native crash (SIGSEGV)"
          tone="danger"
          testID="native-signal"
          onPress={() => ObserveTesting.triggerNativeCrash('signal')}
        />
        <ActionButton
          label="Native exception"
          tone="danger"
          testID="native-exception"
          onPress={() => ObserveTesting.triggerNativeCrash('exception')}
        />
      </View>

      <Text style={styles.section}>Network</Text>
      <View style={styles.group}>
        <ActionButton
          label="GET 200"
          onPress={() => void fetch('https://jsonplaceholder.typicode.com/posts/1')}
        />
        <ActionButton
          label="GET 404"
          onPress={() => void fetch('https://jsonplaceholder.typicode.com/posts/999999/missing')}
        />
        <ActionButton
          label="Network failure"
          onPress={() => void fetch('https://unreachable.invalid/orders/42').catch(() => undefined)}
        />
      </View>

      <Text style={styles.section}>Events</Text>
      <View style={styles.group}>
        <ActionButton
          label="Log checkout event"
          onPress={() =>
            Observe.logEvent('cart.checkout_started', {
              displayName: 'Checkout started',
              attributes: { itemCount: 3, currency: 'EUR' },
            })
          }
        />
        <ActionButton label="Flush now" onPress={() => void Observe.dispatchEvents()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8 },
  status: { fontSize: 13, color: '#475569' },
  section: {
    marginTop: 16,
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  group: { gap: 8 },
});
