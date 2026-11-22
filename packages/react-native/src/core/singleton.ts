import { createReactNativePlatform } from '../platform/react-native';
import { ObservabilityClient } from './client';

let client: ObservabilityClient | null = null;

/** The process-wide client, created on first use. */
export function getClient(): ObservabilityClient {
  client ??= new ObservabilityClient(createReactNativePlatform());
  return client;
}
