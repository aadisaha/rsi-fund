import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { buildDashboardPayload } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireOperatorAccess(req);
  if (denied) return denied;
  const payload = await buildDashboardPayload();
  return NextResponse.json(payload);
}
