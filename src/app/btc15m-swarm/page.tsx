import { headers } from "next/headers";

import { Btc15mSwarmDashboard } from "@/components/Btc15mSwarmDashboard";
import { hasOperatorAccessHeaders } from "@/lib/access";
import { buildBtc15mSwarmDashboardData } from "@/lib/btc15m-swarm-backtest";

export const dynamic = "force-dynamic";

export default async function Btc15mSwarmPage() {
  const requestHeaders = await headers();
  if (!hasOperatorAccessHeaders(requestHeaders)) {
    return (
      <main className="min-h-screen px-5 py-10">
        <section className="mx-auto max-w-2xl rounded-md border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
          <p className="mono text-xs uppercase text-[color:var(--accent-2)]">operator access required</p>
          <h1 className="mt-3 text-2xl font-semibold">BTC 15m Swarm Dashboard Locked</h1>
          <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
            This dashboard reads local backtest artifacts and simulated trade logs. Open it on localhost or send
            AGENT_API_TOKEN as a Bearer token from an operator client.
          </p>
        </section>
      </main>
    );
  }

  const data = await buildBtc15mSwarmDashboardData();
  return <Btc15mSwarmDashboard data={data} />;
}
