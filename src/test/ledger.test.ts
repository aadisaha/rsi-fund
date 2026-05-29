import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let originalCwd: string;
let tmp: string;
let originalDataDir: string | undefined;

async function importLedger() {
  vi.resetModules();
  return import("../lib/ledger");
}

beforeEach(async () => {
  originalCwd = process.cwd();
  originalDataDir = process.env.QUANT_DATA_DIR;
  tmp = await mkdtemp(path.join(tmpdir(), "quant-ledger-"));
  process.env.QUANT_DATA_DIR = path.join(tmp, ".data");
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalDataDir == null) {
    delete process.env.QUANT_DATA_DIR;
  } else {
    process.env.QUANT_DATA_DIR = originalDataDir;
  }
  await rm(tmp, { recursive: true, force: true });
});

describe("ledger", () => {
  it("appends JSONL records newest-first without overwriting", async () => {
    const { appendLedger, readLedger } = await importLedger();

    await appendLedger({ type: "observation", source: "system", payload: { n: 1 } });
    await appendLedger({ type: "observation", source: "system", payload: { n: 2 } });

    const raw = await readFile(path.join(tmp, ".data", "ledger.jsonl"), "utf8");
    expect(raw.trim().split("\n")).toHaveLength(2);

    const rows = await readLedger();
    expect(rows).toHaveLength(2);
    expect(rows[0].payload).toEqual({ n: 2 });
    expect(rows[1].payload).toEqual({ n: 1 });
    expect(rows[0].id).toBeTruthy();
    expect(Date.parse(rows[0].at)).toBeGreaterThan(0);
  });

  it("preserves concurrent appends", async () => {
    const { appendLedger, readLedger } = await importLedger();
    await Promise.all(
      Array.from({ length: 25 }, (_, n) =>
        appendLedger({ type: "observation", source: "system", payload: { n } }),
      ),
    );

    expect(await readLedger(100)).toHaveLength(25);
  });

  it("seeds initial records idempotently", async () => {
    const { readLedger, seedInitialLedger } = await importLedger();
    await seedInitialLedger();
    await seedInitialLedger();

    const rows = await readLedger(10);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.type).sort()).toEqual(["certificate", "model_version"]);
  });
});
