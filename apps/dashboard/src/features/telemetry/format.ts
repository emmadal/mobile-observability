/** Formatting shared by the telemetry pages (issues, sessions, releases). */

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "2 minutes ago", "3 days ago"; dates in the future are worded too. */
export function timeAgo(date: Date, now: number): string {
  const seconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(seconds, 'second');
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86_400), 'day');
}

const dateTime = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});

/** "Nov 24, 2026, 10:53:16" (UTC). */
export function formatDateTime(date: Date): string {
  return dateTime.format(date);
}

const integer = new Intl.NumberFormat('en');

export function formatCount(value: number): string {
  return integer.format(value);
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function formatCompact(value: number): string {
  return compact.format(value);
}

/** "99.95%" with two decimals, or "100%" when exact. */
export function formatPercent(rate: number): string {
  const percent = Math.floor(rate * 10_000) / 100;
  return `${percent.toFixed(percent === 100 ? 0 : 2)}%`;
}

/** A duration between two dates, e.g. "1m 12s". */
export function formatElapsed(from: Date, to: Date): string {
  const seconds = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** The first 8 characters of a uuid-like id, for compact display. */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** "iOS" / "Android": CSS capitalize would render "Ios". */
export function platformLabel(platform: string): string {
  if (platform === 'ios') return 'iOS';
  if (platform === 'android') return 'Android';
  return platform;
}

/** Android release for each API level React Native supports. */
const ANDROID_API_RELEASES: Record<number, string> = {
  21: '5.0',
  22: '5.1',
  23: '6',
  24: '7.0',
  25: '7.1',
  26: '8.0',
  27: '8.1',
  28: '9',
  29: '10',
  30: '11',
  31: '12',
  32: '12L',
  33: '13',
  34: '14',
  35: '15',
  36: '16',
};

/**
 * "Android 14", "iOS 18.1". SDKs running without their native module report the Android API
 * level (34) instead of the release: those read "Android 14 (API 34)". Android releases stay
 * below 21, so a bare integer from 21 up is an API level.
 */
export function osLabel(platform: string, osVersion: string | null): string {
  const name = platformLabel(platform);
  const version = osVersion?.trim();
  if (!version) return `${name}, version unknown`;
  if (platform === 'android' && /^\d+$/.test(version) && Number(version) >= 21) {
    const release = ANDROID_API_RELEASES[Number(version)];
    return release ? `${name} ${release} (API ${version})` : `${name} API ${version}`;
  }
  return `${name} ${version}`;
}

/**
 * "Samsung SM-A546E", "Apple iPhone15,2". The brand is skipped when the model already starts
 * with it ("TECNO KI5q"), and lowercase brands from Build.MANUFACTURER are capitalized.
 */
export function deviceLabel(brand: string | null, model: string | null): string | null {
  const cleanBrand = brand?.trim() || null;
  const cleanModel = model?.trim() || null;
  if (!cleanBrand && !cleanModel) return null;
  if (!cleanBrand) return cleanModel;
  const displayBrand =
    cleanBrand === cleanBrand.toLowerCase()
      ? cleanBrand.charAt(0).toUpperCase() + cleanBrand.slice(1)
      : cleanBrand;
  if (!cleanModel) return displayBrand;
  if (cleanModel.toLowerCase().startsWith(cleanBrand.toLowerCase())) return cleanModel;
  return `${displayBrand} ${cleanModel}`;
}
