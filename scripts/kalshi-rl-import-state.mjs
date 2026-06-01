import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.KALSHI_RL_IMPORT_BASE_URL ?? "https://rsi-fund.vercel.app";
const token = process.env.AGENT_API_TOKEN ?? "";
const chunkSize = Math.max(100_000, Number(process.env.KALSHI_RL_IMPORT_CHUNK_SIZE ?? 650_000));

const files = [
  "kalshi-rl-champion.json",
  "kalshi-rl-last-run.json",
  "kalshi-rl-run-history.json",
  "kalshi-rl-elite-archive.json",
];

if (!token) {
  console.error("AGENT_API_TOKEN is required. Do not paste it into chat; pass it as an environment variable.");
  process.exit(1);
}

async function postChunk(payload) {
  const res = await fetch(`${baseUrl}/api/kalshi/rl/import-state`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json.error ?? `Import failed with HTTP ${res.status}`);
  }
  return json;
}

for (const fileName of files) {
  const filePath = path.join(process.cwd(), ".data", fileName);
  const text = await readFile(filePath, "utf8");
  JSON.parse(text);
  const sha256 = createHash("sha256").update(text).digest("hex");
  const totalChunks = Math.ceil(text.length / chunkSize) || 1;

  let result = null;
  for (let index = 0; index < totalChunks; index += 1) {
    result = await postChunk({
      fileName,
      index,
      totalChunks,
      sha256,
      data: text.slice(index * chunkSize, (index + 1) * chunkSize),
    });
  }

  console.log(
    JSON.stringify({
      fileName,
      complete: Boolean(result?.complete),
      chunks: totalChunks,
      bytes: Buffer.byteLength(text),
      count: result?.count ?? null,
    }),
  );
}
