const baseUrl = process.env.CYCLE_BASE_URL ?? "http://localhost:3000";
const symbols = process.argv.slice(2).join(" ") || process.env.CYCLE_SYMBOLS || "";
const token = process.env.AGENT_API_TOKEN ?? "";

const headers = { "Content-Type": "application/json" };
if (token) headers.Authorization = `Bearer ${token}`;

const res = await fetch(`${baseUrl}/api/cycle/run`, {
  method: "POST",
  headers,
  body: JSON.stringify(symbols ? { symbols } : {}),
});

const json = await res.json().catch(() => ({}));
if (!res.ok || json.ok === false) {
  console.error(json.error ?? `Cycle failed with HTTP ${res.status}`);
  process.exit(1);
}

const cycle = json.cycle ?? {};
console.log(
  JSON.stringify(
    {
      ok: true,
      cycleId: cycle.cycleId,
      generatedAt: cycle.generatedAt,
      rejected: cycle.rejected,
      simulatedFills: cycle.simulatedFills?.length ?? 0,
      reason: cycle.reason,
      riskOk: cycle.risk?.ok,
      jobStatus: json.job?.status,
      runId: json.job?.runId,
    },
    null,
    2,
  ),
);
