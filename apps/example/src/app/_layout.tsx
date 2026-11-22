import '../observability';
import { ObserveErrorBoundary, ObserveRoot } from '@mobile-observability/react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

void SplashScreen.preventAutoHideAsync();

function Fallback() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Something went wrong. The error was reported.</Text>
    </View>
  );
}

function RootLayout() {
  useEffect(() => {
    SplashScreen.hide();
  }, []);

  return (
    <ObserveErrorBoundary fallback={<Fallback />}>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Observability demo' }} />
        <Stack.Screen name="products/index" options={{ title: 'Products' }} />
        <Stack.Screen name="products/[id]" options={{ title: 'Product' }} />
        <Stack.Screen name="slow" options={{ title: 'Slow screen' }} />
      </Stack>
    </ObserveErrorBoundary>
  );
}

export default ObserveRoot.wrap(RootLayout);
