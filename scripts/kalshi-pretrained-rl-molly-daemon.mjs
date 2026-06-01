const intervalMs = Number(process.env.KALSHI_MOLLY_INTERVAL_MS ?? 60_000);

async function runOnce() {
  const proc = await import("node:child_process");
  const child = proc.spawn(process.execPath, ["scripts/kalshi-pretrained-rl-molly.mjs"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  await new Promise((resolve, reject) => {
    child.on("exit", (code) => (code === 0 ? resolve(undefined) : reject(new Error(`molly run exited ${code}`))));
    child.on("error", reject);
  });
}

while (true) {
  const started = Date.now();
  try {
    await runOnce();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
  const elapsed = Date.now() - started;
  const sleepMs = Math.max(1_000, intervalMs - elapsed);
  await new Promise((resolve) => setTimeout(resolve, sleepMs));
}
