const baseUrl = process.env.CYCLE_BASE_URL ?? "http://localhost:3000";
const token = process.env.AGENT_API_TOKEN ?? "";
const once = process.argv.includes("--once") || process.env.CYCLE_WORKER_ONCE === "true";
const pollMs = Math.max(Number(process.env.CYCLE_WORKER_POLL_MS ?? 5000), 1000);

const headers = { "Content-Type": "application/json" };
if (token) headers.Authorization = `Bearer ${token}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function workOnce() {
  const res = await fetch(`${baseUrl}/api/cycle/worker`, {
    method: "POST",
    headers,
    body: "{}",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json.error ?? `Cycle worker failed with HTTP ${res.status}`);
  }
  return json;
}

console.log(
  `Starting paper-cycle worker. baseUrl=${baseUrl} pollMs=${pollMs} once=${once ? "true" : "false"}`,
);

for (;;) {
  try {
    const result = await workOnce();
    if (result.claimed) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            runId: result.job?.runId,
            jobStatus: result.job?.status,
            cycleId: result.cycle?.cycleId ?? result.job?.output?.cycle?.cycleId,
            rejected: result.cycle?.rejected ?? result.job?.output?.cycle?.rejected,
            simulatedFills:
              result.cycle?.simulatedFills?.length ?? result.job?.output?.cycle?.simulatedFills,
            reason: result.cycle?.reason ?? result.job?.output?.cycle?.reason,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(JSON.stringify({ ok: true, claimed: false }, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unknown cycle worker error.");
    if (once) process.exit(1);
  }

  if (once) break;
  await sleep(pollMs);
}
