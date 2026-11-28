/**
 * Filters of the Network page that live in its URL next to the shared
 * overview filters: segment, outcome and a free-text search. Pure module.
 */

export const NETWORK_STATUSES = [
  { key: 'all', label: 'All' },
  { key: 'failed', label: 'Not OK' },
  { key: 'api', label: 'API errors' },
  { key: 'network', label: 'Network failures' },
  { key: 'ok', label: 'OK' },
] as const;

export type NetworkStatus = (typeof NETWORK_STATUSES)[number]['key'];

export const MAX_NETWORK_SEARCH_LENGTH = 128;

export function parseNetworkStatus(value: string | string[] | undefined): NetworkStatus {
  const raw = Array.isArray(value) ? value[0] : value;
  return NETWORK_STATUSES.some((status) => status.key === raw) ? (raw as NetworkStatus) : 'all';
}

/** "KYA", "MERCHANT"; requests whose user has no segment (or no user) read "No segment". */
export function segmentName(segment: string | null): string {
  return segment ? segment.toUpperCase() : 'No segment';
}
