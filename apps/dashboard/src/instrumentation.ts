/**
 * Runs once at server startup, before the first request: validates the
 * environment so a misconfigured deployment fails immediately instead of on
 * the first page load.
 */
export async function register(): Promise<void> {
  await import('@/lib/env');
}
