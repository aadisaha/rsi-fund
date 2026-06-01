import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import {
  appendKalshiOrderbookEvents,
  normalizeKalshiOrderbookEvent,
  normalizeKalshiScreenTick,
  type KalshiScreenTickInput,
} from "@/lib/kalshi-orderbook";
import type { KalshiOrderbookEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

function normalizeOne(raw: unknown): KalshiOrderbookEvent | null {
  if (
    typeof raw === "object" &&
    raw !== null &&
    ("upPrice" in raw || "downPrice" in raw || "currentPrice" in raw || "targetPrice" in raw || "chance" in raw)
  ) {
    return normalizeKalshiScreenTick(raw as KalshiScreenTickInput);
  }
  const direct = normalizeKalshiOrderbookEvent(raw);
  if (direct) return direct;
  if (typeof raw === "object" && raw !== null) {
    return normalizeKalshiScreenTick(raw as KalshiScreenTickInput);
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const denied = requireOperatorAccess(req, { mutation: true });
    if (denied) return denied;
    const body = (await req.json().catch(() => ({}))) as {
      events?: unknown;
      ticks?: unknown;
    };
    const rawEvents = Array.isArray(body.events)
      ? body.events
      : Array.isArray(body.ticks)
        ? body.ticks
        : [body];
    const events = rawEvents
      .map((raw) => normalizeOne(raw))
      .filter((event): event is KalshiOrderbookEvent => Boolean(event));
    await appendKalshiOrderbookEvents(events);
    return NextResponse.json({
      ok: true,
      accepted: events.length,
      latestEventAt: events.at(-1)?.receivedAt ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown Kalshi orderbook ingestion error.",
      },
      { status: 200 },
    );
  }
}
