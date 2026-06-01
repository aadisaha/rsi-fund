import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { deleteDocument, readDocument, writeDocument } from "@/lib/storage";

export const dynamic = "force-dynamic";

const TARGET_NAMESPACE = "kalshi-rl";
const IMPORT_NAMESPACE = "kalshi-rl-import";
const ALLOWED_FILES = new Set([
  "kalshi-rl-champion.json",
  "kalshi-rl-last-run.json",
  "kalshi-rl-run-history.json",
  "kalshi-rl-elite-archive.json",
]);

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

    await writeDocument(IMPORT_NAMESPACE, chunkFileName(fileName, sha256, index), data);

    if (index !== totalChunks - 1) {
      return NextResponse.json({ ok: true, fileName, chunk: index + 1, totalChunks, complete: false });
    }

    const chunks: string[] = [];
    for (let i = 0; i < totalChunks; i += 1) {
      const chunk = await readDocument<string | null>(
        IMPORT_NAMESPACE,
        chunkFileName(fileName, sha256, i),
        null,
        (value) => (typeof value === "string" ? value : null),
      );
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
    await writeDocument(TARGET_NAMESPACE, fileName, value);
    await Promise.all(
      Array.from({ length: totalChunks }, (_, i) =>
        deleteDocument(IMPORT_NAMESPACE, chunkFileName(fileName, sha256, i)),
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
