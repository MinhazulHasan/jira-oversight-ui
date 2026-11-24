import type { NextRequest } from "next/server";

import { signOut } from "@/server/auth/handlers";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return signOut(request);
}
