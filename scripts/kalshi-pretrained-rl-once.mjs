const baseUrl = process.env.CYCLE_BASE_URL ?? "http://localhost:3000";
const token = process.env.AGENT_API_TOKEN ?? "";

const headers = { "Content-Type": "application/json" };
if (token) headers.Authorization = `Bearer ${token}`;

const res = await fetch(`${baseUrl}/api/kalshi/pretrained-rl/infer`, {
  method: "POST",
  headers,
  body: JSON.stringify({}),
});

const json = await res.json().catch(() => ({}));
if (!res.ok || json.ok === false) {
  console.error(json.error ?? `Pretrained RL inference failed with HTTP ${res.status}`);
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, signal: json.result ?? null }, null, 2));
