import type { AllocationProposal, TRsiResult } from "@/lib/types";

function seededNormal(seed: number): () => number {
  let s = seed;
  function rand() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  }
  return () => {
    const u1 = Math.max(rand(), 1e-9);
    const u2 = Math.max(rand(), 1e-9);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / Math.max(xs.length, 1);
}

function sd(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function computeTRsi(proposal: AllocationProposal): TRsiResult {
  const normal = seededNormal(42);
  const total = Math.max(proposal.deployableCapitalUsd, 1);
  const baseCreate = proposal.channels.reduce(
    (sum, c) => sum + (c.proposedUsd / total) * c.meanReturn * c.readiness,
    0,
  );
  const baseSigma = proposal.channels.reduce(
    (sum, c) => sum + ((c.proposedUsd / total) * c.sigma) ** 2,
    0,
  );
  const createSigma = Math.sqrt(baseSigma) || 0.02;
  const decayMean = 0.011;
  const decaySigma = 0.008;

  const createSamples: number[] = [];
  const decaySamples: number[] = [];
  for (let i = 0; i < 400; i += 1) {
    createSamples.push(Math.max(0, baseCreate + normal() * createSigma));
    decaySamples.push(Math.max(0, decayMean + normal() * decaySigma));
  }

  const alphaCreateMean = mean(createSamples);
  const alphaDecayMean = mean(decaySamples);
  const diffSamples = createSamples.map((x, i) => x - decaySamples[i]);
  const standardError = Math.max(sd(diffSamples), 1e-6);
  const tRsi = (alphaCreateMean - alphaDecayMean) / standardError;
  const threshold = 1;
  const approved =
    tRsi >= threshold && proposal.constraints.every((c) => c.ok) && !proposal.killSwitch;

  return {
    generatedAt: new Date().toISOString(),
    status: "experimental_not_audit_ready",
    horizonDays: 90,
    tRsi,
    alphaCreateMean,
    alphaDecayMean,
    standardError,
    threshold,
    approved,
    reason: approved
      ? "Paper certificate clears experimental v0 threshold."
      : "Paper certificate does not clear threshold or constraints.",
    samples: [
      { bucket: "p10", create: quantile(createSamples, 0.1), decay: quantile(decaySamples, 0.1) },
      { bucket: "p50", create: quantile(createSamples, 0.5), decay: quantile(decaySamples, 0.5) },
      { bucket: "p90", create: quantile(createSamples, 0.9), decay: quantile(decaySamples, 0.9) },
    ],
  };
}

function quantile(xs: number[], q: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx] ?? 0;
}
