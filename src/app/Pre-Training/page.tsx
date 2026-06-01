import { headers } from "next/headers";

import { PreTrainingClient } from "@/components/PreTrainingClient";
import { hasOperatorAccessHeaders } from "@/lib/access";
import { readPreTrainingSummary } from "@/lib/pre-training";

export const dynamic = "force-dynamic";

export default async function PreTrainingPage() {
  const requestHeaders = await headers();
  if (!hasOperatorAccessHeaders(requestHeaders)) {
    return (
      <main className="min-h-screen px-5 py-10">
        <section className="mx-auto max-w-2xl rounded-md border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
          <p className="mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent-2)]">
            operator access required
          </p>
          <h1 className="mt-3 text-2xl font-semibold">Pre-Training Locked</h1>
          <p className="mt-3 text-sm text-[color:var(--muted)]">
            Open it on localhost or send AGENT_API_TOKEN as a Bearer token from an operator client.
          </p>
        </section>
      </main>
    );
  }

  const initial = await readPreTrainingSummary();
  return <PreTrainingClient initial={initial} />;
}
