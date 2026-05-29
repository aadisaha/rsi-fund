import "server-only";

import { beginJob, createRunId, finishJob } from "@/lib/jobs";
import { readDocument, storageStatus, writeDocument } from "@/lib/storage";

export type StorageCheckResult = {
  ok: boolean;
  generatedAt: string;
  storage: ReturnType<typeof storageStatus>;
  document: {
    namespace: string;
    roundTrip: boolean;
    checkId: string;
  };
  job: {
    runId: string;
    status: string;
    roundTrip: boolean;
  };
  checks: Array<{
    name: string;
    ok: boolean;
    message: string;
  }>;
};

type StorageCheckDocument = {
  version: 1;
  checkId: string;
  generatedAt: string;
  storageMode: StorageCheckResult["storage"]["mode"];
};

const CHECK_NAMESPACE = "storage-check";
const CHECK_FILE = "storage-check.json";

function normalizeCheckDocument(value: unknown): StorageCheckDocument | null {
  const parsed = value as Partial<StorageCheckDocument>;
  if (parsed.version !== 1 || typeof parsed.checkId !== "string") return null;
  return {
    version: 1,
    checkId: parsed.checkId,
    generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
    storageMode: parsed.storageMode === "postgres" ? "postgres" : "local",
  };
}

export async function runStorageCheck(): Promise<StorageCheckResult> {
  const generatedAt = new Date().toISOString();
  const storage = storageStatus();
  const checkId = `storage-check-${Date.now().toString(36)}`;
  const document: StorageCheckDocument = {
    version: 1,
    checkId,
    generatedAt,
    storageMode: storage.mode,
  };

  await writeDocument(CHECK_NAMESPACE, CHECK_FILE, document);
  const readBack = await readDocument<StorageCheckDocument | null>(
    CHECK_NAMESPACE,
    CHECK_FILE,
    null,
    normalizeCheckDocument,
  );
  const documentRoundTrip = readBack?.checkId === checkId && readBack.storageMode === storage.mode;

  const runId = createRunId("storage-check", checkId);
  await beginJob({
    runId,
    jobName: "storage-check",
    idempotencyKey: checkId,
    input: {
      checkId,
      storageMode: storage.mode,
    },
  });
  const finished = await finishJob(runId, {
    checkId,
    storageMode: storage.mode,
    documentRoundTrip,
  });
  const jobRoundTrip =
    finished.status === "succeeded" &&
    finished.output?.checkId === checkId &&
    finished.output?.storageMode === storage.mode;

  const checks = [
    {
      name: "storage-selected",
      ok: storage.mode === "postgres" || storage.mode === "local",
      message: storage.message,
    },
    {
      name: "document-round-trip",
      ok: documentRoundTrip,
      message: documentRoundTrip
        ? "Document write/read round trip succeeded."
        : "Document write/read round trip failed.",
    },
    {
      name: "job-round-trip",
      ok: jobRoundTrip,
      message: jobRoundTrip
        ? "Job write/finish/read round trip succeeded."
        : "Job write/finish/read round trip failed.",
    },
  ];

  return {
    ok: checks.every((check) => check.ok),
    generatedAt,
    storage,
    document: {
      namespace: CHECK_NAMESPACE,
      roundTrip: documentRoundTrip,
      checkId,
    },
    job: {
      runId,
      status: finished.status,
      roundTrip: jobRoundTrip,
    },
    checks,
  };
}
