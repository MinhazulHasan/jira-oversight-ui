import type { NextRequest } from "next/server";

import { finishSignIn } from "@/server/auth/handlers";

/*
 * Where Atlassian sends people back: APP_URL followed by /api/auth/callback,
 * exactly as registered with the Atlassian app. Checks the state, asks
 * Atlassian who signed in, applies the rules, then starts the session or says
 * why not (src/server/auth/handlers.ts).
 */

// The client secret and node:crypto live in the Node.js server.
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return finishSignIn(request);
}
