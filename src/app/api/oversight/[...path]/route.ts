import type { NextRequest } from "next/server";

import { handle } from "@/server/handler";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: RouteContext<"/api/oversight/[...path]">) {
  const { path } = await context.params;
  return handle("GET", path, request);
}

export async function POST(request: NextRequest, context: RouteContext<"/api/oversight/[...path]">) {
  const { path } = await context.params;
  return handle("POST", path, request);
}

export async function PUT(request: NextRequest, context: RouteContext<"/api/oversight/[...path]">) {
  const { path } = await context.params;
  return handle("PUT", path, request);
}
