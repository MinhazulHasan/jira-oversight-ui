import { NextResponse, type NextRequest } from "next/server";

import { contentSecurityPolicy, createNonce } from "@/lib/csp";
import { issueKeyFromSegment } from "@/lib/issue-key";
import { gate, isApiPath } from "@/server/auth/gate";

const ISSUE_PATH = /^\/issues\/([^/]+)\/?$/;

/**
 * True for an issue address whose key cannot be a Jira key ("/issues/not-a-key").
 * The (app) group streams behind its loading.tsx, so the issue page's own
 * notFound() would go out as a 200. Such an address is rewritten to a path no
 * page owns, which the (missing) catch-all answers outside that boundary with
 * a real 404, in the same shell (see src/app/(missing)/layout.tsx).
 */
function malformedIssueAddress(pathname: string): boolean {
  const match = ISSUE_PATH.exec(pathname);
  return match !== null && issueKeyFromSegment(match[1]) === null;
}

const NO_SUCH_PAGE = "/_no-such-page";

/**
 * Whether a request is one the Content Security Policy is built for: a page,
 * not the API, and not a prefetch, which renders no HTML. These are the
 * requests the matcher alone used to pick out. Next.js strips its own router
 * headers (next-router-prefetch among them) before the proxy sees a request
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md,
 * "RSC requests and rewrites"), so a router prefetch is usually told from a
 * navigation by nothing here and gets the same nonce a navigation does,
 * unused; a browser's own prefetch (Purpose: prefetch) is still recognised.
 */
function wantsPolicy(request: NextRequest): boolean {
  if (isApiPath(request.nextUrl.pathname)) return false;
  return !request.headers.get("next-router-prefetch") && request.headers.get("purpose") !== "prefetch";
}

/**
 * Every request but the build's static files and the icons comes through
 * here. First the sign-in gate (src/server/auth/gate.ts): when sign-in is on,
 * a page without a session goes to /login and anything under /api/ gets a
 * JSON 401, whatever headers it carries. Then every page gets a fresh nonce
 * and the Content Security Policy that names it (src/lib/csp.ts says what the
 * policy allows and why). Next.js reads the nonce back out of the request's
 * policy and stamps it on its own scripts; the root layout reads x-nonce for
 * next-themes' script.
 */
export async function proxy(request: NextRequest) {
  const refusal = await gate(request);
  if (refusal) return refusal;
  if (!wantsPolicy(request)) return NextResponse.next();

  const nonce = createNonce();
  const secure =
    request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const policy = contentSecurityPolicy(nonce, {
    dev: process.env.NODE_ENV === "development",
    secure,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const init = { request: { headers: requestHeaders } };
  const response = malformedIssueAddress(request.nextUrl.pathname)
    ? NextResponse.rewrite(new URL(NO_SUCH_PAGE, request.url), init)
    : NextResponse.next(init);
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    // Everything but the build's static files, image optimisation and the icons: pages with their RSC and
    // prefetch requests, and the API, so the gate sees all it guards. Exact names, so "/favicon.ico/x" is gated.
    "/((?!_next/static/|_next/image$|favicon\\.ico$|icon\\.svg$|apple-icon\\.png$).*)",
  ],
};
