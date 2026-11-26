/**
 * The three variables an app needs, shared with the SDK and `mobs` READMEs.
 * The endpoint and ingest key are EXPO_PUBLIC_ (inlined into the app bundle);
 * the upload token is a secret for the CLI and must never be.
 */
export const MOBS_ENV = {
  endpoint: 'EXPO_PUBLIC_MOBS_ENDPOINT',
  ingestKey: 'EXPO_PUBLIC_MOBS_KEY',
  uploadToken: 'MOBS_UPLOAD_TOKEN',
} as const;

export function envLine(name: keyof typeof MOBS_ENV, value: string): string {
  return `${MOBS_ENV[name]}=${value}`;
}

/** The app's `.env`: the dashboard URL (the SDK appends /api/v1/...) and the ingest key. */
export function appEnv(origin: string, ingestKey: string): string {
  return [envLine('endpoint', origin.replace(/\/+$/, '')), envLine('ingestKey', ingestKey)].join(
    '\n',
  );
}
