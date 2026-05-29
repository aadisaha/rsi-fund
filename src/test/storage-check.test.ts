import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let tmp: string;
let originalDataDir: string | undefined;
let originalStorageDriver: string | undefined;
let originalDatabaseUrl: string | undefined;

beforeEach(async () => {
  originalDataDir = process.env.QUANT_DATA_DIR;
  originalStorageDriver = process.env.QUANT_STORAGE_DRIVER;
  originalDatabaseUrl = process.env.DATABASE_URL;
  tmp = await mkdtemp(path.join(tmpdir(), "quant-storage-check-"));
  process.env.QUANT_DATA_DIR = path.join(tmp, ".data");
  process.env.QUANT_STORAGE_DRIVER = "local";
  delete process.env.DATABASE_URL;
  vi.resetModules();
});

afterEach(async () => {
  if (originalDataDir == null) {
    delete process.env.QUANT_DATA_DIR;
  } else {
    process.env.QUANT_DATA_DIR = originalDataDir;
  }
  if (originalStorageDriver == null) {
    delete process.env.QUANT_STORAGE_DRIVER;
  } else {
    process.env.QUANT_STORAGE_DRIVER = originalStorageDriver;
  }
  if (originalDatabaseUrl == null) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
  await rm(tmp, { recursive: true, force: true });
});

describe("storage check", () => {
  it("round trips a document and job through the selected storage driver", async () => {
    const { runStorageCheck } = await import("@/lib/storage-check");

    const result = await runStorageCheck();

    expect(result.ok).toBe(true);
    expect(result.storage).toMatchObject({ mode: "local", durable: false });
    expect(result.document.roundTrip).toBe(true);
    expect(result.job.roundTrip).toBe(true);
    expect(result.checks.every((check) => check.ok)).toBe(true);

    const document = JSON.parse(
      await readFile(path.join(process.env.QUANT_DATA_DIR!, "storage-check.json"), "utf8"),
    );
    expect(document.checkId).toBe(result.document.checkId);

    const jobs = JSON.parse(
      await readFile(path.join(process.env.QUANT_DATA_DIR!, "jobs.json"), "utf8"),
    );
    expect(jobs.jobs[result.job.runId].status).toBe("succeeded");
  });

  it("serves a write/read smoke check from the storage API route", async () => {
    const { POST } = await import("@/app/api/storage/check/route");

    const response = await POST(
      new Request("http://localhost/api/storage/check", {
        method: "POST",
        headers: { host: "localhost" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.document.roundTrip).toBe(true);
    expect(body.job.roundTrip).toBe(true);
  });

  it("serves read-only storage status from the storage API route", async () => {
    const { GET } = await import("@/app/api/storage/check/route");

    const response = await GET(
      new Request("http://localhost/api/storage/check", {
        headers: { host: "localhost" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.storage.mode).toBe("local");
  });
});
