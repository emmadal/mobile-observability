import { Observe } from '@mobile-observability/react-native';
import { Platform } from 'react-native';

// The Android emulator reaches the host machine through 10.0.2.2.
const defaultEndpoint =
  Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

Observe.configure({
  endpoint: process.env.EXPO_PUBLIC_OBSERVABILITY_ENDPOINT ?? defaultEndpoint,
  apiKey: process.env.EXPO_PUBLIC_OBSERVABILITY_KEY ?? '',
  dispatchInDebug: true,
  environment: process.env.EXPO_PUBLIC_OBSERVABILITY_ENVIRONMENT ?? 'development',
  integrations: { 'expo-router': { filteredParams: ['token'] } },
});
