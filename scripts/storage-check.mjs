const baseUrl = process.env.CYCLE_BASE_URL ?? "http://localhost:3000";
const token = process.env.AGENT_API_TOKEN ?? "";

const headers = { "Content-Type": "application/json" };
if (token) headers.Authorization = `Bearer ${token}`;

const res = await fetch(`${baseUrl}/api/storage/check`, {
  method: "POST",
  headers,
  body: "{}",
});

const json = await res.json().catch(() => ({}));
if (!res.ok || json.ok === false) {
  console.error(json.error ?? `Storage check failed with HTTP ${res.status}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      generatedAt: json.generatedAt,
      storage: json.storage,
      documentRoundTrip: json.document?.roundTrip,
      jobRoundTrip: json.job?.roundTrip,
      runId: json.job?.runId,
    },
    null,
    2,
  ),
);
