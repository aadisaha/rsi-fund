const baseUrl = process.env.CYCLE_BASE_URL ?? "http://localhost:3000";
const symbols = process.argv.slice(2).join(" ") || process.env.CYCLE_SYMBOLS || "";
const token = process.env.AGENT_API_TOKEN ?? "";
const idempotencyKey = process.env.CYCLE_IDEMPOTENCY_KEY ?? "";

const headers = { "Content-Type": "application/json" };
if (token) headers.Authorization = `Bearer ${token}`;

const body = {};
if (symbols) body.symbols = symbols;
if (idempotencyKey) body.idempotencyKey = idempotencyKey;

const res = await fetch(`${baseUrl}/api/cycle/enqueue`, {
  method: "POST",
  headers,
  body: JSON.stringify(body),
});

const json = await res.json().catch(() => ({}));
if (!res.ok || json.ok === false) {
  console.error(json.error ?? `Cycle enqueue failed with HTTP ${res.status}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      queued: json.queued,
      runId: json.job?.runId,
      jobStatus: json.job?.status,
      idempotencyKey: json.job?.idempotencyKey,
      symbols: json.job?.input?.symbols,
    },
    null,
    2,
  ),
);
