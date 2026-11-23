/*
 * The Content Security Policy, built per request by src/proxy.ts. It follows
 * the nonce-based policy documented for Next.js 16
 * (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 *
 * Scripts are the strict part: only scripts carrying the request's nonce run,
 * and 'strict-dynamic' lets those load the app's own chunks. No inline
 * handler, injected <script> or third-party origin can execute.
 *
 * Styles allow inline on purpose. React renders style attributes into the
 * server HTML, Radix and Recharts depend on them, and Sonner injects its
 * stylesheet at runtime without a nonce; a style nonce would silently drop
 * all of that. A style cannot run code, and with img-src, font-src and
 * connect-src locked to 'self' an injected style has nowhere to send what it
 * reads.
 *
 * Dev mode additionally needs 'unsafe-eval' (React rebuilds server error
 * stacks with eval). It is never sent in production.
 */

export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function contentSecurityPolicy(
  nonce: string,
  options: { dev: boolean; secure: boolean },
): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "manifest-src 'self'",
    // Over plain http (a local run) upgrading would send every asset to an https port that is not there.
    ...(options.secure ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
