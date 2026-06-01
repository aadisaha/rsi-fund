const baseUrl = process.env.CYCLE_BASE_URL ?? process.env.KALSHI_LIVE_BASE_URL ?? "http://localhost:3000";
const token = process.env.AGENT_API_TOKEN ?? "";
const intervalMs = Math.max(250, Number(process.env.KALSHI_LIVE_WORKER_INTERVAL_MS ?? 1_000));
const once = process.argv.includes("--once");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tickOnce() {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/api/kalshi/live/tick`, {
    method: "POST",
    headers,
    body: JSON.stringify({ source: "kalshi-live-worker" }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json.error ?? `live tick HTTP ${res.status}`);
  }
  const blockers = json.status?.blockers ?? [];
  console.log(
    JSON.stringify({
      at: json.generatedAt,
      marketTicker: json.tick?.marketTicker ?? null,
      feedAgeMs: json.status?.feed?.ageMs ?? null,
      submitted: json.submitted?.length ?? 0,
      skipped: json.skipped?.length ?? 0,
      blockers,
    }),
  );
  if (blockers.includes("feed-stale") || blockers.includes("reconciliation-stale") || blockers.includes("kill-switch")) {
    process.exitCode = 2;
  }
}

while (true) {
  const started = Date.now();
  try {
    await tickOnce();
  } catch (error) {
    process.exitCode = 1;
    console.error(error instanceof Error ? error.message : String(error));
  }
  if (once) process.exit(process.exitCode ?? 0);
  await sleep(Math.max(250, intervalMs - (Date.now() - started)));
}
