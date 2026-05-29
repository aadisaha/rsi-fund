import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { buildKalshiTrainingEvidence } from "@/lib/kalshi-history";
import { appendLedger } from "@/lib/ledger";
import { buildAllocationProposal } from "@/lib/optimizer";
import { computeTRsi } from "@/lib/trsi";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = requireOperatorAccess(req, { mutation: true });
  if (denied) return denied;
  const proposal = buildAllocationProposal({
    equityUsd: null,
    cashUsd: null,
    kalshiPortfolioUsd: null,
    recentLedgerCount: 0,
  });
  const evidence = await buildKalshiTrainingEvidence();
  const tRsi = computeTRsi(proposal, evidence);
  await appendLedger({
    type: "paper_action",
    action: tRsi.approved ? "proposal" : "rejected",
    channel: "portfolio",
    notionalUsd: proposal.deployableCapitalUsd,
    reason: tRsi.reason,
    payload: { proposal, tRsi },
  });
  await appendLedger({
    type: "certificate",
    approved: tRsi.approved,
    tRsi: tRsi.tRsi,
    threshold: tRsi.threshold,
    reason: tRsi.reason,
    payload: tRsi,
  });
  return NextResponse.json({ ok: true, proposal, tRsi });
}
