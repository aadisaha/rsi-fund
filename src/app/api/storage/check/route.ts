import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { runStorageCheck } from "@/lib/storage-check";
import { storageStatus } from "@/lib/storage-status";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireOperatorAccess(req);
  if (denied) return denied;

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    storage: storageStatus(),
  });
}

export async function POST(req: Request) {
  try {
    const denied = requireOperatorAccess(req, { mutation: true });
    if (denied) return denied;

    const result = await runStorageCheck();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown storage check error.",
      },
      { status: 500 },
    );
  }
}
