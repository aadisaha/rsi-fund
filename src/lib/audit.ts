import "server-only";

import { readLedger } from "@/lib/ledger";
import type {
  LedgerRecord,
  MarketCacheSummary,
  PaperCycleForecast,
  PaperCycleRun,
  TRsiResult,
} from "@/lib/types";

export type AuditCheck = {
  name: string;
  ok: boolean;
  message: string;
};

export type HistoricalReplayBundle = {
  generatedAt: string;
  cycleId: string;
  ledgerLimit: number;
  found: boolean;
  cycle: Pick<
    PaperCycleRun,
    | "cycleId"
    | "generatedAt"
    | "mode"
    | "experimentId"
    | "modelId"
    | "researchDecisionId"
    | "symbols"
    | "timeframe"
    | "cadence"
    | "market"
    | "cache"
    | "proposal"
    | "tRsi"
    | "risk"
    | "forecasts"
    | "simulatedFills"
    | "rejected"
    | "reason"
  > | null;
  evidence: {
    action: LedgerRecord | null;
    forecasts: Array<{
      record: LedgerRecord;
      forecast: PaperCycleForecast | null;
    }>;
    certificate: {
      record: LedgerRecord;
      approved: boolean;
      tRsi: number;
      threshold: number;
      tRsiPayload: TRsiResult | null;
    } | null;
    observations: LedgerRecord[];
    marketDataCutoff: {
      ok: boolean;
      generatedAt: string | null;
      entries: Array<
        MarketCacheSummary["entries"][number] & {
          cutoffAt: string | null;
          ok: boolean;
          message: string;
        }
      >;
    };
    paperOnlyProof: {
      ok: boolean;
      mode: string | null;
      ledgerActionType: string | null;
      action: string | null;
      notionalUsd: number | null;
      liveOrderRecordIds: string[];
      message: string;
    };
  };
  filtration: {
    records: number;
    firstAt: string | null;
    lastAt: string | null;
    actionAt: string | null;
    chronological: boolean;
    leakedRecords: string[];
  };
  checks: AuditCheck[];
  records: LedgerRecord[];
};

function cycleIdFromRecord(record: LedgerRecord): string | null {
  const payload = record.payload as Record<string, unknown> | undefined;
  if (typeof payload?.cycleId === "string") return payload.cycleId;
  const nested = payload?.cycle as Record<string, unknown> | undefined;
  if (typeof nested?.cycleId === "string") return nested.cycleId;
  return null;
}

function isCycleRecord(cycleId: string, record: LedgerRecord): boolean {
  if (cycleIdFromRecord(record) === cycleId) return true;
  if (record.type !== "paper_action") return false;
  const payload = record.payload as Partial<PaperCycleRun> | undefined;
  return payload?.cycleId === cycleId;
}

function runFromRecord(record: LedgerRecord | undefined): PaperCycleRun | null {
  if (!record || record.type !== "paper_action") return null;
  const payload = record.payload as Partial<PaperCycleRun> | undefined;
  return typeof payload?.cycleId === "string" ? (payload as PaperCycleRun) : null;
}

function forecastFromRecord(record: LedgerRecord): PaperCycleForecast | null {
  const payload = record.payload as Record<string, unknown> | undefined;
  const forecast = payload?.forecast as PaperCycleForecast | undefined;
  return forecast && typeof forecast.symbol === "string" ? forecast : null;
}

function tRsiFromCertificate(record: LedgerRecord): TRsiResult | null {
  const payload = record.payload as Record<string, unknown> | undefined;
  const tRsi = payload?.tRsi as TRsiResult | undefined;
  return tRsi && typeof tRsi.generatedAt === "string" ? tRsi : null;
}

function compareRecords(a: LedgerRecord, b: LedgerRecord): number {
  const aAt = Date.parse(a.at);
  const bAt = Date.parse(b.at);
  if (Number.isFinite(aAt) && Number.isFinite(bAt) && aAt !== bAt) return aAt - bAt;
  return a.id.localeCompare(b.id);
}

function isChronological(records: LedgerRecord[]): boolean {
  return records.every((record, index) => index === 0 || compareRecords(records[index - 1], record) <= 0);
}

function isDecisionInputRecord(record: LedgerRecord): boolean {
  if (record.type === "forecast" || record.type === "model_version") return true;
  if (record.type !== "observation") return false;
  const payload = record.payload as Record<string, unknown> | undefined;
  return Boolean(payload?.cache || payload?.outcomeEvaluation);
}

function buildMarketDataCutoff(run: PaperCycleRun | null): HistoricalReplayBundle["evidence"]["marketDataCutoff"] {
  if (!run) return { ok: false, generatedAt: null, entries: [] };
  const generatedAt = Date.parse(run.generatedAt);
  const entries = run.cache.entries.map((entry) => {
    const end = entry.end ? Date.parse(entry.end) : Number.NaN;
    const fetchedAt = Date.parse(entry.fetchedAt);
    const ok =
      Number.isFinite(generatedAt) &&
      Number.isFinite(end) &&
      end <= generatedAt &&
      Number.isFinite(fetchedAt) &&
      fetchedAt <= generatedAt;
    return {
      ...entry,
      cutoffAt: entry.end,
      ok,
      message: ok
        ? "Cache fetch and final bar are no later than cycle generation."
        : "Cache fetch or final bar is missing, invalid, or later than cycle generation.",
    };
  });
  return {
    ok: entries.length > 0 && entries.every((entry) => entry.ok),
    generatedAt: run.generatedAt,
    entries,
  };
}

function buildPaperOnlyProof(
  records: LedgerRecord[],
  actionRecord: LedgerRecord | undefined,
  run: PaperCycleRun | null,
): HistoricalReplayBundle["evidence"]["paperOnlyProof"] {
  const liveOrderRecordIds = records
    .filter((record) => {
      const payload = record.payload as Record<string, unknown> | undefined;
      const kind = `${record.type} ${payload?.type ?? ""} ${payload?.orderType ?? ""}`.toLowerCase();
      return kind.includes("live_order") || kind.includes("broker_order");
    })
    .map((record) => record.id);
  const ok =
    Boolean(run) &&
    run?.mode === "paper" &&
    actionRecord?.type === "paper_action" &&
    liveOrderRecordIds.length === 0;
  return {
    ok,
    mode: run?.mode ?? null,
    ledgerActionType: actionRecord?.type ?? null,
    action: actionRecord?.type === "paper_action" ? actionRecord.action : null,
    notionalUsd: actionRecord?.type === "paper_action" ? actionRecord.notionalUsd : null,
    liveOrderRecordIds,
    message: ok
      ? "Cycle is represented by a paper_action record with paper mode and no broker order records."
      : "Paper-only proof is incomplete.",
  };
}

export async function buildHistoricalReplayBundle(
  cycleId: string,
  limit = 5_000,
): Promise<HistoricalReplayBundle> {
  const allRecords = await readLedger(limit);
  const records = allRecords.filter((record) => isCycleRecord(cycleId, record)).sort(compareRecords);
  const actionRecord = records.find((record) => record.type === "paper_action");
  const run = runFromRecord(actionRecord);
  const actionAtMs = actionRecord ? Date.parse(actionRecord.at) : null;
  const leakedRecords =
    actionAtMs == null
      ? []
      : records
          .filter((record) => Date.parse(record.at) > actionAtMs && isDecisionInputRecord(record))
          .map((record) => record.id);
  const forecasts = records.filter((record) => record.type === "forecast");
  const certificates = records.filter((record) => record.type === "certificate");
  const certificate = certificates.at(-1) ?? null;
  const marketDataCutoff = buildMarketDataCutoff(run);
  const paperOnlyProof = buildPaperOnlyProof(records, actionRecord, run);
  const chronological = isChronological(records);
  const forecastSymbols = new Set(forecasts.map((record) => record.target));
  const runForecastSymbols = new Set(run?.forecasts.map((forecast) => forecast.symbol) ?? []);
  const forecastsMatchRun =
    Boolean(run) &&
    forecasts.length === (run?.forecasts.length ?? 0) &&
    [...runForecastSymbols].every((symbol) => forecastSymbols.has(symbol));
  const certificateTRsi = certificate ? tRsiFromCertificate(certificate) : null;
  const certificateMatchesRun =
    Boolean(run && certificate) &&
    certificate?.type === "certificate" &&
    certificate.approved === run?.tRsi.approved &&
    certificate.tRsi === run?.tRsi.tRsi &&
    certificate.threshold === run?.tRsi.threshold;

  const checks: AuditCheck[] = [
    {
      name: "cycle-recorded",
      ok: Boolean(run),
      message: run ? "Cycle action payload was found in the ledger." : "No cycle action payload found.",
    },
    {
      name: "forecasts-recorded",
      ok: forecastsMatchRun,
      message: run
        ? `${forecasts.length} forecast record${forecasts.length === 1 ? "" : "s"} reconstructed for ${run.forecasts.length} cycle forecast${run.forecasts.length === 1 ? "" : "s"}.`
        : "No cycle action payload available for forecast reconciliation.",
    },
    {
      name: "certificate-recorded",
      ok: Boolean(certificate),
      message: certificate
        ? `${certificates.length} certificate record${certificates.length === 1 ? "" : "s"} found.`
        : "No certificate record found.",
    },
    {
      name: "certificate-matches-cycle",
      ok: certificateMatchesRun,
      message: certificateMatchesRun
        ? "Certificate approval, t-RSI, and threshold match the cycle payload."
        : "Certificate values do not match the cycle payload, or either record is missing.",
    },
    {
      name: "filtration-order",
      ok: chronological && leakedRecords.length === 0,
      message: leakedRecords.length
        ? `${leakedRecords.length} decision input record${leakedRecords.length === 1 ? "" : "s"} after the action timestamp.`
        : chronological
          ? "Replay records are chronological and no post-action inputs are required to reconstruct the decision."
          : "Replay records are not chronological.",
    },
    {
      name: "market-data-cutoff",
      ok: marketDataCutoff.ok,
      message: run
        ? marketDataCutoff.ok
          ? "Cached market data ends no later than the cycle generation time."
          : "At least one cache entry has an invalid or future cutoff."
        : "No cycle payload available for cache cutoff checks.",
    },
    {
      name: "paper-only",
      ok: paperOnlyProof.ok,
      message: paperOnlyProof.message,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    cycleId,
    ledgerLimit: limit,
    found: Boolean(run),
    cycle: run
      ? {
          cycleId: run.cycleId,
          generatedAt: run.generatedAt,
          mode: run.mode,
          experimentId: run.experimentId,
          modelId: run.modelId,
          researchDecisionId: run.researchDecisionId,
          symbols: run.symbols,
          timeframe: run.timeframe,
          cadence: run.cadence,
          market: run.market,
          cache: run.cache,
          proposal: run.proposal,
          tRsi: run.tRsi,
          risk: run.risk,
          forecasts: run.forecasts,
          simulatedFills: run.simulatedFills,
          rejected: run.rejected,
          reason: run.reason,
        }
      : null,
    evidence: {
      action: actionRecord ?? null,
      forecasts: forecasts.map((record) => ({
        record,
        forecast: forecastFromRecord(record),
      })),
      certificate: certificate
        ? {
            record: certificate,
            approved: certificate.approved,
            tRsi: certificate.tRsi,
            threshold: certificate.threshold,
            tRsiPayload: certificateTRsi,
          }
        : null,
      observations: records.filter((record) => record.type === "observation"),
      marketDataCutoff,
      paperOnlyProof,
    },
    filtration: {
      records: records.length,
      firstAt: records[0]?.at ?? null,
      lastAt: records.at(-1)?.at ?? null,
      actionAt: actionRecord?.at ?? null,
      chronological,
      leakedRecords,
    },
    checks,
    records,
  };
}
