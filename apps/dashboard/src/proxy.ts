import { type NextRequest, NextResponse } from 'next/server';

/**
 * Session gate + Content-Security-Policy, following the Next.js guides
 * (authentication: optimistic proxy checks; CSP: per-request nonces).
 *
 * The proxy only checks that a Better Auth session cookie is present — it
 * never verifies the cookie, because proxy runs outside the render pipeline
 * and must not depend on shared modules or the database. Every protected page
 * re-verifies the session server-side through `getCurrentUser()` in
 * src/lib/auth/session.ts.
 */
const SESSION_COOKIE = 'better-auth.session_token';

function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has(SESSION_COOKIE) ||
    request.cookies.has(`__Secure-${SESSION_COOKIE}`) ||
    request.cookies.has(`__Host-${SESSION_COOKIE}`)
  );
}

/**
 * A fresh nonce per request. Next.js reads it from the request's CSP header
 * and applies it to its own scripts and inline styles while rendering, which
 * is why pages render dynamically (no prerendered shell could carry it).
 */
function buildCsp(): { header: string; nonce: string } {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const header = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''};
    style-src 'self' 'nonce-${nonce}';
    img-src 'self' blob: data:;
    font-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
  `
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { header, nonce };
}

function nextWithCsp(request: NextRequest, csp: string, nonce: string): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Next.js takes the nonce from the request-side CSP header.
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

function redirectWithCsp(location: URL, csp: string): NextResponse {
  const response = NextResponse.redirect(location);
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { header: csp, nonce } = buildCsp();
  const hasSession = hasSessionCookie(request);

  // Auth pages stay reachable while anonymous; signed-in visitors are sent to
  // the dashboard. The session itself is re-verified by the pages.
  if (pathname === '/login' || pathname === '/signup') {
    if (hasSession) return redirectWithCsp(new URL('/', request.url), csp);
    return nextWithCsp(request, csp, nonce);
  }

  if (!hasSession) {
    const login = new URL('/login', request.url);
    // Carry the intended destination so login can send the user back after
    // signing in. The server action sanitizes it before redirecting.
    if (pathname !== '/') login.searchParams.set('next', `${pathname}${search}`);
    return redirectWithCsp(login, csp);
  }

  return nextWithCsp(request, csp, nonce);
}

export const config = {
  matcher: [
    {
      // Everything except Better Auth endpoints, the key-authed ingest API and
      // static assets. /_next/data is still proxied despite the exclusion
      // (documented behaviour), so protected data routes stay covered.
      source:
        '/((?!api/auth|api/v1|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
      // Skip link prefetches: they carry no credentials-bearing navigation and
      // protected pages re-verify the session themselves.
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
