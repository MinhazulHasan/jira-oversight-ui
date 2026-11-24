import "server-only";

import type { ApiErrorBody, ApiErrorCode } from "@/lib/api/schemas";

/** Every response from /api/oversight is JSON and never cached: the figures */
const NO_STORE_HEADERS = { "cache-control": "no-store" } as const;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

export function problem(
  status: number,
  error: ApiErrorCode,
  message: string,
  issues?: ApiErrorBody["issues"],
): Response {
  const body: ApiErrorBody = issues && issues.length > 0 ? { error, message, issues } : { error, message };
  return json(body, status);
}
