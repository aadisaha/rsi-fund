import "server-only";

export type StorageMode = "local" | "postgres";

export function storageMode(): StorageMode {
  const forced = process.env.QUANT_STORAGE_DRIVER?.trim().toLowerCase();
  if (forced === "local") return "local";
  return process.env.DATABASE_URL?.trim() ? "postgres" : "local";
}

export function storageStatus(): {
  mode: StorageMode;
  durable: boolean;
  message: string;
} {
  const mode = storageMode();
  return mode === "postgres"
    ? {
        mode,
        durable: true,
        message: "Postgres is the authoritative store.",
      }
    : {
        mode,
        durable: false,
        message: "Local .data files are authoritative; use DATABASE_URL for durable storage.",
      };
}
