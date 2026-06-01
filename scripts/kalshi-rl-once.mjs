const baseUrl = process.env.CYCLE_BASE_URL ?? "http://localhost:3000";
const token = process.env.AGENT_API_TOKEN ?? "";

let waitForDataMs = Number(process.env.KALSHI_RL_WAIT_MS ?? 15 * 60 * 1000);
let pollMs = Number(process.env.KALSHI_RL_POLL_MS ?? 5_000);
const args = process.argv.slice(2);

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--no-wait") {
    waitForDataMs = 0;
  } else if (arg === "--wait-ms") {
    waitForDataMs = Number(args[++i] ?? waitForDataMs);
  } else if (arg === "--poll-ms") {
    pollMs = Number(args[++i] ?? pollMs);
  } else if (arg === "--help" || arg === "-h") {
    console.log("Usage: npm run kalshi:rl-once -- [--no-wait] [--wait-ms 300000] [--poll-ms 5000]");
    process.exit(0);
  } else {
    throw new Error(`Unknown argument: ${arg}`);
  }
}

const headers = { "Content-Type": "application/json" };
if (token) headers.Authorization = `Bearer ${token}`;

const res = await fetch(`${baseUrl}/api/kalshi/rl/train`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    waitForDataMs: Number.isFinite(waitForDataMs) ? waitForDataMs : 0,
    pollMs: Number.isFinite(pollMs) ? pollMs : 5_000,
  }),
});

const json = await res.json().catch(() => ({}));
if (!res.ok || json.ok === false) {
  console.error(json.error ?? `Kalshi RL training failed with HTTP ${res.status}`);
  process.exit(1);
}

const result = json.result ?? {};
console.log(
  JSON.stringify(
    {
      ok: true,
      runId: result.runId,
      generatedAt: result.generatedAt,
      eventCount: result.eventCount,
      evaluatedMarkets: result.evaluatedMarkets,
      promoted: result.promoted,
      bestReward: result.best?.reward ?? null,
      championReward: result.champion?.reward ?? null,
      notes: result.notes,
    },
    null,
    2,
  ),
);
