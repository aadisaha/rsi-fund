import type {
  AllocationProposal,
  ChannelEstimate,
  DashboardPayload,
} from "@/lib/types";

const DEFAULT_CHANNELS: ChannelEstimate[] = [
  {
    id: "I",
    name: "Investments",
    description: "Paper rebalance budget using forecast edge minus friction.",
    meanReturn: 0.075,
    sigma: 0.042,
    readiness: 0.74,
    source: "Alpaca account state + baseline momentum proxy",
  },
  {
    id: "S",
    name: "Sensors",
    description: "Data purchases and point-in-time feature coverage.",
    meanReturn: 0.047,
    sigma: 0.026,
    readiness: 0.66,
    source: "White-paper prior; needs local scaling-law fit",
  },
  {
    id: "U",
    name: "Actuators",
    description: "Tradable universe, routes, venues, and event-market surface.",
    meanReturn: 0.039,
    sigma: 0.024,
    readiness: 0.61,
    source: "White-paper prior; needs universe expansion panel",
  },
  {
    id: "Z",
    name: "R&D",
    description: "Research experiments, model variants, and evaluation tooling.",
    meanReturn: 0.033,
    sigma: 0.031,
    readiness: 0.58,
    source: "Experiment frontier placeholder",
  },
  {
    id: "Theta",
    name: "Parameters",
    description: "Model training scale and refit cadence.",
    meanReturn: 0.018,
    sigma: 0.022,
    readiness: 0.43,
    source: "Symbolic pending model-size sweep",
  },
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function envNumber(name: string): number | null {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function buildAllocationProposal(args: {
  equityUsd: number | null;
  cashUsd: number | null;
  kalshiPortfolioUsd: number | null;
  recentLedgerCount: number;
  investmentEstimate?: ChannelEstimate;
}): AllocationProposal {
  const paperEquity = envNumber("PAPER_STARTING_EQUITY_USD");
  const equity = args.equityUsd ?? paperEquity ?? 0;
  const cash = args.cashUsd ?? (paperEquity == null ? 0 : Math.max(1_000, paperEquity * 0.25));
  const deployable =
    equity > 0 && cash > 0
      ? clamp(Math.min(cash * 0.35, equity * 0.08), 250, 10_000)
      : 0;
  const riskAversion = 0.65;
  const killSwitch = false;

  const channelsInput = DEFAULT_CHANNELS.map((c) =>
    c.id === "I" && args.investmentEstimate ? args.investmentEstimate : c,
  );

  const scored = channelsInput.map((c) => ({
    ...c,
    riskAdjustedScore: (c.meanReturn / Math.max(c.sigma, 0.001)) * c.readiness,
    proposedUsd: 0,
  }));

  const positive = scored.filter((c) => c.riskAdjustedScore > 0);
  const totalScore = positive.reduce((sum, c) => sum + c.riskAdjustedScore, 0);
  const channels = scored.map((c) => ({
    ...c,
    proposedUsd:
      c.riskAdjustedScore > 0 && totalScore > 0
        ? Math.round((deployable * c.riskAdjustedScore) / totalScore)
        : 0,
  }));

  const minCash = Math.max(1_000, equity * 0.05);
  const constraints = [
    {
      name: "paper-only execution",
      ok: true,
      message: "No API route in this app places live orders.",
    },
    {
      name: "capital source",
      ok: deployable > 0,
      message:
        args.equityUsd != null
          ? "Sizing uses read-only Alpaca account state."
          : paperEquity != null
            ? "Sizing uses explicit PAPER_STARTING_EQUITY_USD."
            : "Set up Alpaca paper reads or PAPER_STARTING_EQUITY_USD before cycles can allocate.",
    },
    {
      name: "budget",
      ok: channels.reduce((sum, c) => sum + c.proposedUsd, 0) <= deployable,
      message: `Paper proposal capped at ${deployable.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      })}.`,
    },
    {
      name: "liquidity floor",
      ok: cash - deployable >= minCash,
      message: `Cash reserve floor is ${minCash.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      })}.`,
    },
    {
      name: "kalshi read-only",
      ok: true,
      message: `Kalshi portfolio input is ${args.kalshiPortfolioUsd == null ? "unavailable" : "read-only"}.`,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    mode: "paper",
    deployableCapitalUsd: deployable,
    shadowPrice:
      channels.reduce((sum, c) => sum + c.riskAdjustedScore, 0) /
      Math.max(channels.length, 1),
    riskAversion,
    killSwitch,
    channels,
    constraints,
    summary:
      args.recentLedgerCount > 3
        ? args.investmentEstimate
          ? "Paper allocation uses local ledger context and paper-book calibrated investment estimates."
          : "Paper allocation uses local ledger context and static channel priors."
        : deployable > 0
          ? "Bootstrap paper allocation; add backtests and forecasts to tighten priors."
          : "Capital source unavailable; proposal is withheld until paper capital is explicit.",
  };
}

export function proposalFromDashboard(payload: DashboardPayload): AllocationProposal {
  return buildAllocationProposal({
    equityUsd: payload.accounts.alpaca.equityUsd,
    cashUsd: payload.accounts.alpaca.cashUsd,
    kalshiPortfolioUsd: payload.accounts.kalshi.portfolioValueUsd,
    recentLedgerCount: payload.ledger.length,
    investmentEstimate: payload.investmentCalibration.channel,
  });
}
