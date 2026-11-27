import { Observe } from '@mobile-observability/react-native';
import { Platform } from 'react-native';

// The Android emulator reaches the host machine through 10.0.2.2.
const defaultEndpoint =
  Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';

Observe.configure({
  endpoint: process.env.EXPO_PUBLIC_MOBS_ENDPOINT ?? defaultEndpoint,
  apiKey: process.env.EXPO_PUBLIC_MOBS_KEY ?? '',
  dispatchInDebug: true,
  environment: process.env.EXPO_PUBLIC_MOBS_ENVIRONMENT ?? 'development',
  // Keep what the API answered on 4xx/5xx (credential-like keys are redacted).
  networkErrorBodiesEnabled: true,
  integrations: { 'expo-router': { filteredParams: ['token'] } },
});
