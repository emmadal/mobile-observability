import { useObserve } from '@mobile-observability/react-native';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

function blockFor(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Simulates an expensive synchronous render (large JSON parse, heavy layout).
  }
}

export default function SlowScreen() {
  blockFor(700);
  const { markInteractive } = useObserve();
  useEffect(() => markInteractive(), [markInteractive]);
  return (
    <View style={styles.container}>
      <Text>This screen blocks the JS thread for 700 ms while rendering.</Text>
    </View>
  );
}

const styles = StyleSheet.create({ container: { padding: 16 } });
