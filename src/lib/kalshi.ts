import "server-only";

import { constants, sign } from "node:crypto";

import { envTrim, normalizePem } from "@/lib/env";
import type { KalshiPosition, ServiceStatus } from "@/lib/types";

const PROD_BASE = "https://external-api.kalshi.com";
const DEMO_BASE = "https://external-api.demo.kalshi.co";

type KalshiBalanceRaw = {
  balance?: number;
  portfolio_value?: number;
};

type KalshiPositionsRaw = {
  market_positions?: KalshiPosition[];
};

export type KalshiSnapshot = {
  ok: true;
  mode: "demo" | "production";
  balanceUsd: number | null;
  portfolioValueUsd: number | null;
  positions: KalshiPosition[];
} | {
  ok: false;
  mode: "demo" | "production" | "unconfigured";
  message: string;
};

export type KalshiMarketInfo = {
  ticker: string;
  title?: string;
  subtitle?: string;
  yesBid: number | null;
  yesAsk: number | null;
  lastPrice: number | null;
  closeTime: string | null;
};

function credentials(): { keyId: string; pem: string } | null {
  const keyId = envTrim(process.env.KALSHI_API_KEY_ID);
  const pem = normalizePem(process.env.KALSHI_PRIVATE_KEY_PEM);
  return keyId && pem ? { keyId, pem } : null;
}

export function kalshiMode(): "demo" | "production" {
  const production = envTrim(process.env.KALSHI_PRODUCTION).toLowerCase();
  if (["1", "true", "yes", "on"].includes(production)) return "production";
  if (["0", "false", "no", "off"].includes(production)) return "demo";

  const demo = envTrim(process.env.KALSHI_DEMO).toLowerCase();
  if (["1", "true", "yes", "on"].includes(demo)) return "demo";
  if (["0", "false", "no", "off"].includes(demo)) return "production";

  return "demo";
}

export function kalshiBaseUrl(): string {
  return kalshiMode() === "demo" ? DEMO_BASE : PROD_BASE;
}

export function kalshiStatus(): ServiceStatus {
  const creds = credentials();
  const mode = kalshiMode();
  return {
    name: "Kalshi",
    configured: Boolean(creds),
    ok: Boolean(creds),
    mode,
    message: creds
      ? `Configured for ${mode} read-only portfolio data.`
      : "Missing Kalshi API key/private key. Set KALSHI_PRODUCTION=true or KALSHI_DEMO=false only for explicit production diagnostics.",
  };
}

export function kalshiSignedHeaders(method: string, path: string): Record<string, string> {
  const creds = credentials();
  if (!creds) throw new Error("Kalshi is not configured.");
  const ts = Date.now().toString();
  const pathNoQuery = path.split("?")[0];
  const msg = `${ts}${method.toUpperCase()}${pathNoQuery}`;
  const signature = sign("sha256", Buffer.from(msg, "utf8"), {
    key: creds.pem,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString("base64");

  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "KALSHI-ACCESS-KEY": creds.keyId,
    "KALSHI-ACCESS-TIMESTAMP": ts,
    "KALSHI-ACCESS-SIGNATURE": signature,
  };
}

async function kalshiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${kalshiBaseUrl()}${path}`, {
    headers: kalshiSignedHeaders("GET", path),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Kalshi read failed (${res.status}): ${body.slice(0, 180)}`);
  }
  return (await res.json()) as T;
}

export async function kalshiApiGet<T>(path: string): Promise<T> {
  return kalshiGet<T>(path);
}

export async function kalshiApiPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${kalshiBaseUrl()}${path}`, {
    method: "POST",
    headers: kalshiSignedHeaders("POST", path),
    cache: "no-store",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const error = new Error(`Kalshi write failed (${res.status}): ${text.slice(0, 240)}`);
    Object.assign(error, { status: res.status, body: text });
    throw error;
  }
  return (await res.json()) as T;
}

export async function kalshiApiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${kalshiBaseUrl()}${path}`, {
    method: "DELETE",
    headers: kalshiSignedHeaders("DELETE", path),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    const error = new Error(`Kalshi delete failed (${res.status}): ${text.slice(0, 240)}`);
    Object.assign(error, { status: res.status, body: text });
    throw error;
  }
  return (await res.json()) as T;
}

export async function fetchKalshiSnapshot(): Promise<KalshiSnapshot> {
  if (!credentials()) {
    return { ok: false, mode: "unconfigured", message: "Kalshi is not configured." };
  }
  try {
    const [balance, positions] = await Promise.all([
      kalshiGet<KalshiBalanceRaw>("/trade-api/v2/portfolio/balance"),
      kalshiGet<KalshiPositionsRaw>(
        "/trade-api/v2/portfolio/positions?limit=100&count_filter=position&settlement_status=unsettled",
      ).catch(() => ({ market_positions: [] })),
    ]);
    return {
      ok: true,
      mode: kalshiMode(),
      balanceUsd:
        typeof balance.balance === "number" ? balance.balance / 100 : null,
      portfolioValueUsd:
        typeof balance.portfolio_value === "number"
          ? balance.portfolio_value / 100
          : null,
      positions: positions.market_positions ?? [],
    };
  } catch (error) {
    return {
      ok: false,
      mode: kalshiMode(),
      message: error instanceof Error ? error.message : "Unknown Kalshi error.",
    };
  }
}

export async function fetchKalshiMarketInfo(
  ticker: string,
): Promise<KalshiMarketInfo | null> {
  const res = await fetch(
    `${kalshiBaseUrl()}/trade-api/v2/markets/${encodeURIComponent(ticker)}`,
    { headers: { Accept: "application/json" }, cache: "no-store" },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    market?: {
      ticker?: string;
      title?: string;
      subtitle?: string;
      yes_bid_dollars?: string;
      yes_ask_dollars?: string;
      last_price_dollars?: string;
      close_time?: string;
    };
  };
  const m = json.market;
  if (!m?.ticker) return null;
  return {
    ticker: m.ticker,
    title: m.title,
    subtitle: m.subtitle,
    yesBid: m.yes_bid_dollars ? Number(m.yes_bid_dollars) : null,
    yesAsk: m.yes_ask_dollars ? Number(m.yes_ask_dollars) : null,
    lastPrice: m.last_price_dollars ? Number(m.last_price_dollars) : null,
    closeTime: m.close_time ?? null,
  };
}
