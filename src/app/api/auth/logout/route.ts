import type { NextRequest } from "next/server";

import { signOut } from "@/server/auth/handlers";

/*
 * Ends the session. POST only, from the dashboard's own pages (Sign out sends
 * it as a same-origin fetch; a foreign Origin is refused); Next answers any
 * other method with 405, so no link or image elsewhere can sign anyone out
 * (src/server/auth/handlers.ts).
 */

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return signOut(request);
}
