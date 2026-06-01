import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let tmp: string;
let originalDataDir: string | undefined;
let originalEnabled: string | undefined;
let originalSeries: string | undefined;

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

beforeEach(async () => {
  originalDataDir = process.env.QUANT_DATA_DIR;
  originalEnabled = process.env.KALSHI_PRETRAINED_RL_ENABLED;
  originalSeries = process.env.KALSHI_PRETRAINED_RL_SERIES;
  tmp = await mkdtempPath();
  process.env.QUANT_DATA_DIR = tmp;
  delete process.env.KALSHI_PRETRAINED_RL_ENABLED;
  process.env.KALSHI_PRETRAINED_RL_SERIES = "KXBTC15M";
  vi.resetModules();
});

afterEach(async () => {
  restoreEnv("QUANT_DATA_DIR", originalDataDir);
  restoreEnv("KALSHI_PRETRAINED_RL_ENABLED", originalEnabled);
  restoreEnv("KALSHI_PRETRAINED_RL_SERIES", originalSeries);
  await rm(tmp, { recursive: true, force: true });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function mkdtempPath() {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(path.join(tmpdir(), "pretrained-rl-"));
}

describe("kalshi pretrained RL isolation", () => {
  it("is disabled by default and reads only the pretrained namespace", async () => {
    const pretrainedDir = path.join(tmp, "kalshi-pretrained-rl");
    await writeJson(path.join(tmp, "kalshi-rl-last-run.json"), { runId: "genetic-run" });
    await writeJson(path.join(pretrainedDir, "last-run.json"), {
      runId: "kalshi-pretrained-rl-test",
      generatedAt: "2026-05-29T12:00:00.000Z",
      seriesTicker: "KXBTC15M",
      device: "cpu",
      enabled: false,
      artifactDir: pretrainedDir,
      historyDir: "history",
      candles: 10,
      samples: { train: 1, validation: 1, test: 1 },
      markets: { train: 1, validation: 1, test: 1 },
      featureNames: [],
      actionNames: [],
      model: { dModel: 64, heads: 4, layers: 3, sequenceMinutes: 32 },
      metrics: {
        train: { samples: 1, avgReward: 0, totalReward: 0, trades: 0, actionCounts: {} },
        validation: { samples: 1, avgReward: 0, totalReward: 0, trades: 0, actionCounts: {} },
        test: { samples: 1, avgReward: 0, totalReward: 0, trades: 0, actionCounts: {} },
      },
      promoted: true,
      notes: [],
    });

    const { readKalshiPretrainedRlSummary } = await import("@/lib/kalshi-pretrained-rl");
    const summary = await readKalshiPretrainedRlSummary();

    expect(summary.enabled).toBe(false);
    expect(summary.lastRun?.runId).toBe("kalshi-pretrained-rl-test");
    expect(JSON.parse(await readFile(path.join(tmp, "kalshi-rl-last-run.json"), "utf8")).runId).toBe("genetic-run");
  });

  it("serves summary through the isolated API route", async () => {
    const { GET } = await import("@/app/api/kalshi/pretrained-rl/summary/route");

    const response = await GET(new Request("http://localhost/api/kalshi/pretrained-rl/summary", {
      headers: { host: "localhost" },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.summary.seriesTicker).toBe("KXBTC15M");
    expect(body.summary.enabled).toBe(false);
  });

  it("denies non-local training requests without operator credentials before sidecar execution", async () => {
    const { POST } = await import("@/app/api/kalshi/pretrained-rl/train/route");

    const response = await POST(new Request("https://example.com/api/kalshi/pretrained-rl/train", {
      method: "POST",
      headers: { host: "example.com", origin: "https://attacker.example" },
    }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
  });

  it("denies non-local Molly paper-live requests without operator credentials before sidecar execution", async () => {
    const { POST } = await import("@/app/api/kalshi/pretrained-rl/molly/route");

    const response = await POST(new Request("https://example.com/api/kalshi/pretrained-rl/molly", {
      method: "POST",
      headers: { host: "example.com", origin: "https://attacker.example" },
    }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
  });
});
