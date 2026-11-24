import type { NextRequest } from "next/server";

import { finishSignIn } from "@/server/auth/handlers";

// The client secret and node:crypto live in the Node.js server.
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return finishSignIn(request);
}
