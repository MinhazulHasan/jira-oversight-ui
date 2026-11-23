import type { NextRequest } from "next/server";

import { handle } from "@/server/handler";

/*
 * The credential boundary: the browser talks only to this route, and only
 * this route talks to the oversight service (src/server/handler.ts). GET for
 * the read endpoints; POST for Ask, Sync now and (JO-15) a preview or a save of
 * the board's rule settings; Next answers any other method with 405. It sends
 * no CORS headers, so a page on another site never gets past a preflight.
 */

// The service key and node:crypto both live in the Node.js server. (If Cache
// Components is ever turned on, this line must go: it does not allow it.)
export const runtime = "nodejs";

export async function GET(request: NextRequest, context: RouteContext<"/api/oversight/[...path]">) {
  const { path } = await context.params;
  return handle("GET", path, request);
}

export async function POST(request: NextRequest, context: RouteContext<"/api/oversight/[...path]">) {
  const { path } = await context.params;
  return handle("POST", path, request);
}
