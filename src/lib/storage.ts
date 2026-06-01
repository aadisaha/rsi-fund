import "server-only";

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { Pool, type QueryResultRow } from "pg";

import { storageMode } from "@/lib/storage-status";
export { storageMode, storageStatus, type StorageMode } from "@/lib/storage-status";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function localDataDirOverride(): string | null {
  const value = process.env.QUANT_DATA_DIR?.trim();
  return value ? value : null;
}

export function dataDir(): string {
  return (
    localDataDirOverride() ??
    path.join(/*turbopackIgnore: true*/ process.cwd(), ".data")
  );
}

export function dataPath(fileName: string): string {
  const override = localDataDirOverride();
  if (override) return path.join(override, fileName);
  return path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", fileName);
}

function postgresPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.POSTGRES_POOL_MAX ?? 5),
      ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export async function ensurePostgresSchema(): Promise<void> {
  if (storageMode() !== "postgres") return;
  schemaReady ??= (async () => {
    const db = postgresPool();
    await db.query(`
      create table if not exists quant_documents (
        namespace text not null,
        file_name text not null,
        value jsonb not null,
        updated_at timestamptz not null default now(),
        primary key (namespace, file_name)
      );

      alter table quant_documents
        add column if not exists file_name text;

      update quant_documents
         set file_name = namespace
       where file_name is null;

      do $$
      begin
        if exists (
          select 1
            from pg_constraint
           where conrelid = 'quant_documents'::regclass
             and conname = 'quant_documents_pkey'
             and contype = 'p'
             and pg_get_constraintdef(oid) = 'PRIMARY KEY (namespace)'
        ) then
          alter table quant_documents drop constraint quant_documents_pkey;
        end if;
      end $$;

      alter table quant_documents
        alter column namespace set not null,
        alter column file_name set not null;

      create unique index if not exists quant_documents_namespace_file_name_idx
        on quant_documents (namespace, file_name);

      create table if not exists quant_ledger_records (
        id text primary key,
        at timestamptz not null,
        type text not null,
        event jsonb not null
      );

      create index if not exists quant_ledger_records_at_idx
        on quant_ledger_records (at desc);

      create index if not exists quant_ledger_records_type_idx
        on quant_ledger_records (type);

      create table if not exists quant_job_runs (
        run_id text primary key,
        job_name text not null,
        status text not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        started_at timestamptz not null,
        finished_at timestamptz,
        idempotency_key text,
        input jsonb,
        output jsonb,
        error text
      );

      create index if not exists quant_job_runs_status_updated_idx
        on quant_job_runs (status, updated_at desc);

      create index if not exists quant_job_runs_idempotency_idx
        on quant_job_runs (job_name, idempotency_key);

      create table if not exists quant_kalshi_orderbook_events (
        event_id text primary key,
        received_at timestamptz not null,
        series_ticker text,
        market_ticker text not null,
        event jsonb not null
      );

      create index if not exists quant_kalshi_orderbook_events_series_received_idx
        on quant_kalshi_orderbook_events (series_ticker, received_at desc);

      create index if not exists quant_kalshi_orderbook_events_market_received_idx
        on quant_kalshi_orderbook_events (market_ticker, received_at desc);

      create table if not exists quant_kalshi_live_intents (
        client_order_id text primary key,
        intent jsonb not null,
        status text not null,
        created_at timestamptz not null,
        updated_at timestamptz not null
      );

      create index if not exists quant_kalshi_live_intents_status_updated_idx
        on quant_kalshi_live_intents (status, updated_at desc);

      create table if not exists quant_kalshi_live_reconciliation_runs (
        run_id text primary key,
        started_at timestamptz not null,
        finished_at timestamptz not null,
        ok boolean not null,
        mismatch_count integer not null,
        run jsonb not null
      );

      create index if not exists quant_kalshi_live_reconciliation_finished_idx
        on quant_kalshi_live_reconciliation_runs (finished_at desc);
    `);
  })();
  await schemaReady;
}

export async function pgQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await ensurePostgresSchema();
  const result = await postgresPool().query<T>(sql, params);
  return result.rows;
}

export async function readJsonFile<T>(
  fileName: string,
  fallback: T,
  normalize: (value: unknown) => T,
): Promise<T> {
  const raw = await readFile(dataPath(fileName), "utf8").catch(() => "");
  if (!raw.trim()) return fallback;
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(fileName: string, value: unknown): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  const target = dataPath(fileName);
  const temp = path.join(
    dataDir(),
    `${fileName}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );

  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temp, target);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

export async function readDocument<T>(
  namespace: string,
  fileName: string,
  fallback: T,
  normalize: (value: unknown) => T,
): Promise<T> {
  if (storageMode() === "postgres") {
    const rows = await pgQuery<{ value: unknown }>(
      "select value from quant_documents where namespace = $1 and file_name = $2",
      [namespace, fileName],
    );
    return rows[0] ? normalize(rows[0].value) : fallback;
  }
  return readJsonFile(fileName, fallback, normalize);
}

export async function writeDocument(
  namespace: string,
  fileName: string,
  value: unknown,
): Promise<void> {
  if (storageMode() === "postgres") {
    await pgQuery(
      `insert into quant_documents (namespace, file_name, value, updated_at)
       values ($1, $2, $3::jsonb, now())
       on conflict (namespace, file_name)
       do update set value = excluded.value, updated_at = now()`,
      [namespace, fileName, JSON.stringify(value)],
    );
    return;
  }
  await writeJsonFile(fileName, value);
}

export async function deleteDocument(namespace: string, fileName: string): Promise<void> {
  if (storageMode() === "postgres") {
    await pgQuery(
      "delete from quant_documents where namespace = $1 and file_name = $2",
      [namespace, fileName],
    );
    return;
  }
  await unlink(dataPath(fileName)).catch(() => undefined);
}
