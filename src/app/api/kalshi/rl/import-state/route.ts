import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { Pool } from "pg";

import { requireOperatorAccess } from "@/lib/access";
import { deleteDocument, readDocument, storageMode, writeDocument } from "@/lib/storage";

export const dynamic = "force-dynamic";

const TARGET_NAMESPACE = "kalshi-rl";
const IMPORT_NAMESPACE = "kalshi-rl-import";
const ALLOWED_FILES = new Set([
  "kalshi-rl-champion.json",
  "kalshi-rl-last-run.json",
  "kalshi-rl-run-history.json",
  "kalshi-rl-elite-archive.json",
]);

let importPool: Pool | null = null;

function postgresPool(): Pool {
  importPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  return importPool;
}

type ImportChunk = {
  fileName?: string;
  index?: number;
  totalChunks?: number;
  sha256?: string;
  data?: string;
};

function chunkFileName(fileName: string, sha256: string, index: number): string {
  return `${sha256}/${fileName}.${index}.chunk`;
}

function validSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

async function writeImportDocument(namespace: string, fileName: string, value: unknown): Promise<void> {
  if (storageMode() !== "postgres") {
    await writeDocument(namespace, fileName, value);
    return;
  }
  await postgresPool().query(
    `insert into quant_documents (namespace, file_name, value, updated_at)
     values ($1, $2, $3::jsonb, now())
     on conflict (namespace, file_name)
     do update set value = excluded.value, updated_at = now()`,
    [namespace, fileName, JSON.stringify(value)],
  );
}

async function readImportDocument(namespace: string, fileName: string): Promise<unknown | null> {
  if (storageMode() !== "postgres") {
    return readDocument<unknown | null>(namespace, fileName, null, (value) => value);
  }
  const result = await postgresPool().query<{ value: unknown }>(
    "select value from quant_documents where namespace = $1 and file_name = $2",
    [namespace, fileName],
  );
  return result.rows[0]?.value ?? null;
}

async function deleteImportDocument(namespace: string, fileName: string): Promise<void> {
  if (storageMode() !== "postgres") {
    await deleteDocument(namespace, fileName);
    return;
  }
  await postgresPool().query(
    "delete from quant_documents where namespace = $1 and file_name = $2",
    [namespace, fileName],
  );
}

export async function POST(req: Request) {
  const denied = requireOperatorAccess(req, { mutation: true });
  if (denied) return denied;

  try {
    const body = (await req.json()) as ImportChunk;
    const fileName = body.fileName?.trim() ?? "";
    const index = Number(body.index);
    const totalChunks = Number(body.totalChunks);
    const sha256 = body.sha256?.trim() ?? "";
    const data = body.data;

    if (!ALLOWED_FILES.has(fileName)) {
      return NextResponse.json({ ok: false, error: "Unsupported RL state file." }, { status: 400 });
    }
    if (!Number.isInteger(index) || !Number.isInteger(totalChunks) || index < 0 || totalChunks < 1 || index >= totalChunks) {
      return NextResponse.json({ ok: false, error: "Invalid chunk index." }, { status: 400 });
    }
    if (!validSha256(sha256)) {
      return NextResponse.json({ ok: false, error: "Invalid sha256." }, { status: 400 });
    }
    if (typeof data !== "string") {
      return NextResponse.json({ ok: false, error: "Chunk data must be a string." }, { status: 400 });
    }

    if (totalChunks === 1) {
      const actual = createHash("sha256").update(data).digest("hex");
      if (actual !== sha256.toLowerCase()) {
        return NextResponse.json({ ok: false, error: "Checksum mismatch." }, { status: 409 });
      }

      const value = JSON.parse(data) as unknown;
      await writeImportDocument(TARGET_NAMESPACE, fileName, value);
      const count = Array.isArray(value) ? value.length : undefined;
      return NextResponse.json({ ok: true, fileName, complete: true, bytes: Buffer.byteLength(data), count });
    }

    await writeImportDocument(IMPORT_NAMESPACE, chunkFileName(fileName, sha256, index), data);

    if (index !== totalChunks - 1) {
      return NextResponse.json({ ok: true, fileName, chunk: index + 1, totalChunks, complete: false });
    }

    const chunks: string[] = [];
    for (let i = 0; i < totalChunks; i += 1) {
      const value = await readImportDocument(IMPORT_NAMESPACE, chunkFileName(fileName, sha256, i));
      const chunk = typeof value === "string" ? value : null;
      if (chunk == null) {
        return NextResponse.json({ ok: false, error: `Missing chunk ${i}.` }, { status: 409 });
      }
      chunks.push(chunk);
    }

    const jsonText = chunks.join("");
    const actual = createHash("sha256").update(jsonText).digest("hex");
    if (actual !== sha256.toLowerCase()) {
      return NextResponse.json({ ok: false, error: "Checksum mismatch." }, { status: 409 });
    }

    const value = JSON.parse(jsonText) as unknown;
    await writeImportDocument(TARGET_NAMESPACE, fileName, value);
    await Promise.all(
      Array.from({ length: totalChunks }, (_, i) =>
        deleteImportDocument(IMPORT_NAMESPACE, chunkFileName(fileName, sha256, i)),
      ),
    );

    const count = Array.isArray(value) ? value.length : undefined;
    return NextResponse.json({ ok: true, fileName, complete: true, bytes: Buffer.byteLength(jsonText), count });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown RL state import error." },
      { status: 500 },
    );
  }
}
