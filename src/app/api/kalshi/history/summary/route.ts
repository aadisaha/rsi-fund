import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { buildKalshiTrainingEvidence, readKalshiHistoryManifest } from "@/lib/kalshi-history";

export async function GET(req: Request) {
  const denied = requireOperatorAccess(req);
  if (denied) return denied;

  const [manifest, evidence] = await Promise.all([
    readKalshiHistoryManifest(),
    buildKalshiTrainingEvidence(),
  ]);
  return NextResponse.json({
    ok: true,
    manifest,
    evidence: evidence
      ? {
          source: evidence.source,
          sampleSize: evidence.sampleSize,
          minSamples: evidence.minSamples,
          horizonMinutes: evidence.horizonMinutes,
          markets: evidence.markets,
        }
      : null,
  });
}
