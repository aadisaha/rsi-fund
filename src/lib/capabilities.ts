import "server-only";

import { configured } from "@/lib/env";
import { storageMode } from "@/lib/storage-status";
import type { OpsCapabilityGroup, SecretStatus } from "@/lib/types";

function hasAny(names: string[]): boolean {
  return names.some((name) => configured(name));
}

export function buildSecretStatus(): SecretStatus[] {
  return [
    {
      name: "Alpaca",
      configured: hasAny(["ALPACA_API_KEY_ID", "APCA_API_KEY_ID"]) &&
        hasAny(["ALPACA_API_SECRET_KEY", "APCA_API_SECRET_KEY"]),
      variables: ["ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY", "ALPACA_PAPER"],
      purpose: "Read-only account state, historical bars, and paper broker reference capital.",
    },
    {
      name: "Kalshi",
      configured: hasAny(["KALSHI_API_KEY_ID"]) && hasAny(["KALSHI_PRIVATE_KEY_PEM"]),
      variables: ["KALSHI_API_KEY_ID", "KALSHI_PRIVATE_KEY_PEM", "KALSHI_PRODUCTION", "KALSHI_DEMO"],
      purpose: "Read-only balance, positions, and event-market portfolio context.",
    },
    {
      name: "OpenRouter",
      configured: hasAny(["OPENROUTER_API_KEY"]),
      variables: ["OPENROUTER_API_KEY", "OPENROUTER_MODEL"],
      purpose: "Optional LLM research agents, reports, and experiment diagnostics.",
    },
    {
      name: "DigitalOcean",
      configured: hasAny(["DIGITALOCEAN_ACCESS_TOKEN"]),
      variables: ["DIGITALOCEAN_ACCESS_TOKEN"],
      purpose: "Managed deployment, Postgres, always-on workers, and scheduled jobs.",
    },
    {
      name: "Cloudflare",
      configured: hasAny(["CLOUDFLARE_API_TOKEN", "CF_API_TOKEN"]),
      variables: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
      purpose: "Workers, queues, R2 artifacts, WAF/access control, and public hosting.",
    },
  ];
}

export function buildOpsCapabilityGroups(): OpsCapabilityGroup[] {
  const durableStorage = storageMode() === "postgres";
  return [
    {
      name: "Built locally now",
      status: "ready",
      items: [
        "Next.js cockpit with read-only Alpaca/Kalshi status.",
        "Paper-only cycle runner for BTC/ETH/SOL 15-minute bars.",
        "Append-only local ledger and paper book under .data/.",
        "Optimizer proposal and experimental t-RSI certificate tracking.",
        "Local backtest diagnostic runner and cache inspection.",
      ],
    },
    {
      name: "Durable persistence",
      status: durableStorage ? "ready" : "blocked",
      items: [
        "Postgres schema for ledger records, document stores, and durable job runs.",
        "DATABASE_URL switches ledger/book/cache/jobs/experiments/research decisions away from .data files.",
        "Local .data fallback remains available for development and tests.",
      ],
    },
    {
      name: "Needs DigitalOcean credits",
      status: configured("DIGITALOCEAN_ACCESS_TOKEN") || durableStorage ? "ready" : "blocked",
      items: [
        "Managed Postgres for durable ledgers and experiment registry.",
        "Always-on workers for unattended cycle collection.",
        "Long-running backtests and model jobs with persistent volumes.",
        "Private production deployment with restart policies and log retention.",
      ],
    },
    {
      name: "Needs Cloudflare credits",
      status:
        configured("CLOUDFLARE_API_TOKEN") || configured("CF_API_TOKEN")
          ? "ready"
          : "blocked",
      items: [
        "Public dashboard hosting behind Access/WAF.",
        "Queues for async cycle/backtest jobs.",
        "R2 storage for backtest artifacts, model snapshots, and audit bundles.",
        "Cron Triggers for edge-level heartbeat checks.",
      ],
    },
    {
      name: "Needs OpenRouter credits",
      status: configured("OPENROUTER_API_KEY") ? "ready" : "blocked",
      items: [
        "Research-agent summaries over ledger and paper outcomes.",
        "Automated experiment proposals with explicit no-trade constraints.",
        "Natural-language operator reports and anomaly explanations.",
        "Model-diagnostic narratives grounded in recorded metrics.",
      ],
    },
  ];
}
