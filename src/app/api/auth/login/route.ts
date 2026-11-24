import type { NextRequest } from "next/server";

import { startSignIn } from "@/server/auth/handlers";

// The secret and node:crypto live in the Node.js server.
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return startSignIn(request);
}
