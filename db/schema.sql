create table if not exists quant_documents (
  namespace text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

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
