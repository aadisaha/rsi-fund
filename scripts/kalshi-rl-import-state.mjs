import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function readLocalEnv(name) {
  for (const fileName of [".env.local", ".env.vercel.production.local"]) {
    const text = await readFile(path.join(process.cwd(), fileName), "utf8").catch(() => "");
    for (const line of text.split(/\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match || match[1] !== name) continue;
      return match[2].trim().replace(/^"|"$/g, "");
    }
  }
  return "";
}

const baseUrl = process.env.KALSHI_RL_IMPORT_BASE_URL ?? "https://rsi-fund.vercel.app";
const token = process.env.AGENT_API_TOKEN ?? (await readLocalEnv("AGENT_API_TOKEN"));
const chunkSize = Math.max(100_000, Number(process.env.KALSHI_RL_IMPORT_CHUNK_SIZE ?? 650_000));
const requestTimeoutMs = Math.max(10_000, Number(process.env.KALSHI_RL_IMPORT_TIMEOUT_MS ?? 60_000));
const historyLimit = Math.max(1, Number(process.env.KALSHI_RL_IMPORT_HISTORY_LIMIT ?? 20));
const importFullHistory = process.env.KALSHI_RL_IMPORT_FULL_HISTORY === "true";

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let res;
  try {
    res = await fetch(`${baseUrl}/api/kalshi/rl/import-state`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Import request timed out after ${requestTimeoutMs}ms for ${payload.fileName} chunk ${payload.index + 1}/${payload.totalChunks}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok || json.ok === false) {
    throw new Error(json.error ?? text ?? `Import failed with HTTP ${res.status}`);
  }
  return json;
}

for (const fileName of files) {
  const filePath = path.join(process.cwd(), ".data", fileName);
  const rawText = await readFile(filePath, "utf8");
  let value = JSON.parse(rawText);
  if (fileName === "kalshi-rl-run-history.json" && Array.isArray(value) && !importFullHistory) {
    const before = value.length;
    value = value.slice(0, historyLimit);
    console.log(
      JSON.stringify({
        fileName,
        mode: "pruned",
        keptRuns: value.length,
        originalRuns: before,
        note: "Set KALSHI_RL_IMPORT_FULL_HISTORY=true to upload the full local run history.",
      }),
    );
  }
  const text = JSON.stringify(value);
  const sha256 = createHash("sha256").update(text).digest("hex");
  const totalChunks = Math.ceil(text.length / chunkSize) || 1;

  let result = null;
  console.log(JSON.stringify({ fileName, chunks: totalChunks, bytes: Buffer.byteLength(text), status: "uploading" }));
  for (let index = 0; index < totalChunks; index += 1) {
    result = await postChunk({
      fileName,
      index,
      totalChunks,
      sha256,
      data: text.slice(index * chunkSize, (index + 1) * chunkSize),
    });
    console.log(JSON.stringify({ fileName, chunk: index + 1, totalChunks, complete: Boolean(result?.complete) }));
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
