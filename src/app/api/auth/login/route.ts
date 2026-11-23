import type { NextRequest } from "next/server";

import { startSignIn } from "@/server/auth/handlers";

/*
 * Starts signing in with Atlassian: remembers a random state in a short-lived
 * sealed cookie, then sends the browser to Atlassian's consent screen.
 * ?next=/path is where to come back to (src/server/auth/handlers.ts).
 */

// The secret and node:crypto live in the Node.js server.
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return startSignIn(request);
}
