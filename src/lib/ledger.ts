import "server-only";

import { appendFile, mkdir, readFile } from "node:fs/promises";

import { dataDir, dataPath, pgQuery, storageMode } from "@/lib/storage";
import type { LedgerEvent, LedgerRecord } from "@/lib/types";

const LEDGER_FILE = "ledger.jsonl";

function id(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureDataDir(): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
}

export async function appendLedger(event: LedgerEvent): Promise<LedgerRecord> {
  const record: LedgerRecord = {
    ...event,
    id: id(),
    at: new Date().toISOString(),
  };
  if (storageMode() === "postgres") {
    await pgQuery(
      `insert into quant_ledger_records (id, at, type, event)
       values ($1, $2, $3, $4::jsonb)
       on conflict (id) do nothing`,
      [record.id, record.at, record.type, JSON.stringify(record)],
    );
    return record;
  }

  await ensureDataDir();
  await appendFile(dataPath(LEDGER_FILE), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export async function readLedger(limit = 100): Promise<LedgerRecord[]> {
  if (storageMode() === "postgres") {
    const rows = await pgQuery<{ event: LedgerRecord }>(
      "select event from quant_ledger_records order by at desc limit $1",
      [Math.max(0, limit)],
    );
    return rows.map((row) => row.event);
  }

  const raw = await readFile(dataPath(LEDGER_FILE), "utf8").catch(() => "");
  if (!raw.trim()) return [];
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as LedgerRecord)
    .slice(-limit)
    .reverse();
}

export async function seedInitialLedger(): Promise<void> {
  const records = await readLedger(1);
  if (records.length) return;
  await appendLedger({
    type: "model_version",
    modelId: "ewm-v0-baseline",
    dataCutoff: new Date().toISOString(),
    score: 0,
    payload: {
      note: "Bootstrap model record. Replace with sealed chronological evaluations.",
    },
  });
  await appendLedger({
    type: "certificate",
    approved: false,
    tRsi: 0,
    threshold: 1,
    reason: "No channel history yet; paper-only bootstrap state.",
    payload: { status: "experimental_not_audit_ready" },
  });
}
