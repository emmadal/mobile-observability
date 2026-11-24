/**
 * Client network context captured at the edge: the request IP as seen by the
 * server and the geo headers set by the CDN (Vercel, Cloudflare). Apps never
 * send these; trusting device-provided values would make them spoofable.
 */

export interface ClientContext {
  ip: string | null;
  /** ISO 3166-1 alpha-2 country code, e.g. "FR". */
  country: string | null;
  city: string | null;
}

const MAX_IP_LENGTH = 45; // longest IPv6 textual form
const MAX_COUNTRY_LENGTH = 8;
const MAX_CITY_LENGTH = 96;

function firstIp(header: string | null): string | null {
  if (!header) return null;
  // x-forwarded-for is "client, proxy1, proxy2": the leftmost value is the client.
  const candidate = header.split(',')[0]?.trim();
  return candidate && candidate.length <= MAX_IP_LENGTH ? candidate : null;
}

/** Decodes a header value, returning null for broken encodings. */
function decoded(value: string | null): string | null {
  if (!value) return null;
  try {
    const text = decodeURIComponent(value).trim();
    return text ? text.slice(0, MAX_CITY_LENGTH) : null;
  } catch {
    return null;
  }
}

/** Reads the client network context from proxy/CDN headers. */
export function clientContextOf(request: Request): ClientContext {
  const ip =
    firstIp(request.headers.get('x-forwarded-for')) ?? firstIp(request.headers.get('x-real-ip'));
  const country = request.headers.get('x-vercel-ip-country') ?? request.headers.get('cf-ipcountry');
  return {
    ip,
    country: country?.slice(0, MAX_COUNTRY_LENGTH) || null,
    city: decoded(request.headers.get('x-vercel-ip-city')),
  };
}
