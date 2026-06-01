const baseUrl = process.env.CYCLE_BASE_URL ?? "http://localhost:3000";
const token = process.env.AGENT_API_TOKEN ?? "";

const headers = { "Content-Type": "application/json" };
if (token) headers.Authorization = `Bearer ${token}`;

const res = await fetch(`${baseUrl}/api/kalshi/pretrained-rl/train`, {
  method: "POST",
  headers,
  body: JSON.stringify({}),
});

const json = await res.json().catch(() => ({}));
if (!res.ok || json.ok === false) {
  console.error(json.error ?? `Pretrained RL training failed with HTTP ${res.status}`);
  process.exit(1);
}

const result = json.result ?? {};
console.log(
  JSON.stringify(
    {
      ok: true,
      runId: result.runId,
      generatedAt: result.generatedAt,
      candles: result.candles,
      samples: result.samples,
      promoted: result.promoted,
      validationReward: result.metrics?.validation?.avgReward ?? null,
      latestSignal: result.latestSignal ?? null,
      notes: result.notes,
    },
    null,
    2,
  ),
);
