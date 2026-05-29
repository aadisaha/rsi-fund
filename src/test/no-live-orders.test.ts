import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const forbidden = [
  "/v2/orders",
  "submitOrder",
  "placeOrder",
  "cancelOrder",
  "createOrder",
];

describe("no live order surface", () => {
  it("does not contain broker order-placement call sites", async () => {
    const files = [
      "src/lib/alpaca.ts",
      "src/lib/kalshi.ts",
      "src/lib/kalshi-history.ts",
      "src/app/api/cycle/run/route.ts",
      "src/app/api/cycle/enqueue/route.ts",
      "src/app/api/cycle/worker/route.ts",
      "src/app/api/kalshi/history/backfill/route.ts",
      "src/app/api/paper/propose/route.ts",
      "src/components/DashboardClient.tsx",
      "scripts/kalshi-history-backfill.mjs",
    ];

    const contents = await Promise.all(
      files.map((file) => readFile(path.join(process.cwd(), file), "utf8")),
    );

    for (const source of contents) {
      for (const needle of forbidden) {
        expect(source).not.toContain(needle);
      }
    }
  });
});
