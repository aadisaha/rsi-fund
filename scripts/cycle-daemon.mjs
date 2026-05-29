const intervalMs = Number(process.env.CYCLE_INTERVAL_MS ?? 15 * 60 * 1000);
const minIntervalMs = 60 * 1000;
const delay = Math.max(intervalMs, minIntervalMs);

async function runOnce() {
  const started = new Date().toISOString();
  const child = await import("node:child_process");
  return new Promise((resolve) => {
    const proc = child.spawn(process.execPath, ["scripts/cycle-once.mjs"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    proc.on("exit", (code) => {
      resolve({ started, code });
    });
  });
}

console.log(
  `Starting paper-cycle daemon. intervalMs=${delay} baseUrl=${
    process.env.CYCLE_BASE_URL ?? "http://localhost:3000"
  }`,
);

for (;;) {
  const result = await runOnce();
  if (result.code !== 0) {
    console.error(`Cycle attempt from ${result.started} failed with code ${result.code}.`);
  }
  await new Promise((resolve) => setTimeout(resolve, delay));
}
