import { NextResponse, type NextRequest } from "next/server";

import { contentSecurityPolicy, createNonce } from "@/lib/csp";
import { issueKeyFromSegment } from "@/lib/issue-key";
import { gate, isApiPath } from "@/server/auth/gate";

const ISSUE_PATH = /^\/issues\/([^/]+)\/?$/;

function malformedIssueAddress(pathname: string): boolean {
  const match = ISSUE_PATH.exec(pathname);
  return match !== null && issueKeyFromSegment(match[1]) === null;
}

const NO_SUCH_PAGE = "/_no-such-page";

function wantsPolicy(request: NextRequest): boolean {
  if (isApiPath(request.nextUrl.pathname)) return false;
  return !request.headers.get("next-router-prefetch") && request.headers.get("purpose") !== "prefetch";
}

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
    "/((?!_next/static/|_next/image$|favicon\\.ico$|icon\\.svg$|apple-icon\\.png$).*)",
  ],
};
