import "server-only";

import { envTrim } from "@/lib/env";
import type { AlpacaPosition, ServiceStatus } from "@/lib/types";

const PAPER_BASE = "https://paper-api.alpaca.markets";
const LIVE_BASE = "https://api.alpaca.markets";
const DATA_BASE = "https://data.alpaca.markets";

type AlpacaAccountRaw = {
  equity?: string;
  cash?: string;
  buying_power?: string;
  non_marginable_buying_power?: string;
  status?: string;
};

type AlpacaPortfolioHistoryRaw = {
  timestamp?: number[];
  equity?: number[];
};

export type AlpacaBarTimeframe = "1Day" | "15Min";

export type AlpacaMarketBar = {
  at: string;
  close: number;
};

export type AlpacaAccountSnapshot = {
  ok: true;
  mode: "paper" | "live";
  equityUsd: number | null;
  cashUsd: number | null;
  buyingPowerUsd: number | null;
  positions: AlpacaPosition[];
  history: Array<{ at: string; valueUsd: number }>;
} | {
  ok: false;
  mode: "paper" | "live" | "unconfigured";
  message: string;
};

function credentials(): { key: string; secret: string } | null {
  const key =
    envTrim(process.env.ALPACA_API_KEY_ID) || envTrim(process.env.APCA_API_KEY_ID);
  const secret =
    envTrim(process.env.ALPACA_API_SECRET_KEY) ||
    envTrim(process.env.APCA_API_SECRET_KEY);
  return key && secret ? { key, secret } : null;
}

export function alpacaMode(): "paper" | "live" {
  return process.env.ALPACA_PAPER === "false" ? "live" : "paper";
}

function liveReadsAllowed(): boolean {
  return alpacaMode() === "paper" || process.env.ALLOW_LIVE_READS === "true";
}

export function alpacaStatus(): ServiceStatus {
  const creds = credentials();
  const mode = alpacaMode();
  const blocked = mode === "live" && !liveReadsAllowed();
  return {
    name: "Alpaca",
    configured: Boolean(creds),
    ok: Boolean(creds) && !blocked,
    mode,
    message: blocked
      ? "Live Alpaca reads are blocked. Set ALLOW_LIVE_READS=true only for explicit diagnostics."
      : creds
      ? `Configured for ${mode} read-only account, stock, and crypto market data.`
      : "Missing Alpaca API key/secret.",
  };
}

function headers(): HeadersInit | null {
  const creds = credentials();
  if (!creds) return null;
  return {
    "APCA-API-KEY-ID": creds.key,
    "APCA-API-SECRET-KEY": creds.secret,
    Accept: "application/json",
  };
}

function accountBase(): string {
  return alpacaMode() === "live" ? LIVE_BASE : PAPER_BASE;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function alpacaGet<T>(url: string): Promise<T> {
  const h = headers();
  if (!h) throw new Error("Alpaca is not configured.");
  const res = await fetch(url, { headers: h, cache: "no-store" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Alpaca read failed (${res.status}): ${body.slice(0, 180)}`);
  }
  return (await res.json()) as T;
}

export async function fetchAlpacaSnapshot(): Promise<AlpacaAccountSnapshot> {
  if (!credentials()) {
    return { ok: false, mode: "unconfigured", message: "Alpaca is not configured." };
  }
  if (!liveReadsAllowed()) {
    return {
      ok: false,
      mode: alpacaMode(),
      message:
        "Live Alpaca reads are blocked. Keep ALPACA_PAPER=true for the MVP or set ALLOW_LIVE_READS=true for diagnostics.",
    };
  }

  try {
    const [account, positions, history] = await Promise.all([
      alpacaGet<AlpacaAccountRaw>(`${accountBase()}/v2/account`),
      alpacaGet<AlpacaPosition[]>(`${accountBase()}/v2/positions`),
      alpacaGet<AlpacaPortfolioHistoryRaw>(
        `${accountBase()}/v2/account/portfolio/history?period=1M&timeframe=1D`,
      ).catch(() => ({ timestamp: [], equity: [] })),
    ]);

    return {
      ok: true,
      mode: alpacaMode(),
      equityUsd: num(account.equity),
      cashUsd: num(account.cash),
      buyingPowerUsd: num(account.non_marginable_buying_power) ?? num(account.buying_power),
      positions,
      history: (history.timestamp ?? []).map((t, i) => ({
        at: new Date(t * 1000).toISOString(),
        valueUsd: Number(history.equity?.[i] ?? 0),
      })),
    };
  } catch (error) {
    return {
      ok: false,
      mode: alpacaMode(),
      message: error instanceof Error ? error.message : "Unknown Alpaca error.",
    };
  }
}

export async function fetchAlpacaDailyBars(
  symbol: string,
  days = 90,
): Promise<AlpacaMarketBar[]> {
  const h = headers();
  if (!h) throw new Error("Alpaca is not configured.");
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const url = new URL(`${DATA_BASE}/v2/stocks/bars`);
  url.searchParams.set("symbols", symbol.toUpperCase());
  url.searchParams.set("timeframe", "1Day");
  url.searchParams.set("start", start.toISOString());
  url.searchParams.set("end", end.toISOString());
  url.searchParams.set("limit", "1000");
  url.searchParams.set("feed", "iex");
  const json = await alpacaGet<{ bars?: Record<string, Array<{ t: string; c: number }>> }>(
    url.toString(),
  );
  return (json.bars?.[symbol.toUpperCase()] ?? []).map((b) => ({
    at: b.t,
    close: b.c,
  }));
}

export async function fetchAlpacaCryptoBars(
  symbol: string,
  days = 21,
  timeframe: AlpacaBarTimeframe = "15Min",
): Promise<AlpacaMarketBar[]> {
  const h = headers();
  if (!h) throw new Error("Alpaca is not configured.");
  const normalized = symbol.toUpperCase();
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const url = new URL(`${DATA_BASE}/v1beta3/crypto/us/bars`);
  url.searchParams.set("symbols", normalized);
  url.searchParams.set("timeframe", timeframe);
  url.searchParams.set("start", start.toISOString());
  url.searchParams.set("end", end.toISOString());
  url.searchParams.set("limit", "10000");
  url.searchParams.set("sort", "asc");

  const bars: Array<{ t: string; c: number }> = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const json = await alpacaGet<{
      bars?: Record<string, Array<{ t: string; c: number }>>;
      next_page_token?: string;
    }>(url.toString());
    bars.push(...(json.bars?.[normalized] ?? []));
    pageToken = json.next_page_token;
    if (!pageToken) break;
  }

  return bars.map((b) => ({
    at: b.t,
    close: b.c,
  }));
}
