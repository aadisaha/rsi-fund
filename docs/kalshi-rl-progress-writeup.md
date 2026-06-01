# Kalshi BTC 15M Paper RL Progress Writeup

Generated during the May 29, 2026 PT build session.

## Executive Summary

We built a paper-only real-time learning loop for Kalshi BTC 15-minute markets around `KXBTC15M`. The system now ingests live market ticks, simulates paper trades for genetic agents, tracks open positions and marked PnL, updates the dashboard every second, and includes a pretrained Molly benchmark family that can run on a recurring daemon.

The current system is not a live trading system. It has no route that creates, amends, or cancels Kalshi orders. Everything described here is paper-shadow evaluation.

The most important empirical finding so far is that agents can look healthy for many generations, then collapse at the live edge when they carry correlated wrong-side exposure into the final minute of a binary market. That is not necessarily a display bug. It is a real endgame-risk problem that should become part of what the agents learn.

## What Has Been Built

### Live Kalshi BTC 15M Data Path

- Added a local orderbook/ticker ingestion path for `KXBTC15M`.
- Supports appending normalized JSONL events under `.data/kalshi-orderbook`.
- Captures market ticker, timestamps, yes/no bid/ask, chance, spread, raw screen/orderbook fields, and close-window metadata.
- The dashboard infers the active Kalshi URL from the 15-minute market naming convention and keeps checking the current window.
- `/rl` refreshes the RL and pretrained summaries every second while the tab is active.

### Genetic Paper RL Loop

- Added a paper-only genetic policy trainer for Kalshi BTC 15-minute markets.
- Population defaults to 64 policies, with at least 20 active rows visible in the live table.
- Starting bankroll is configurable, defaulting to `$1,000`.
- Per-market and total exposure caps are configurable.
- Agents simulate entries, exits, marked open exposure, stale quote rejection, settlement-style resolution, and PnL.
- Policies evolve through compact genomes, including thresholds, max hold seconds, spread/depth constraints, time-to-close bands, stop-loss, take-profit, and size fraction.
- The RL daemon can run recurring learning updates. We shortened the practical cadence from 15 minutes to 5 minutes for faster iteration.

### Reward Function Iteration

The reward function evolved through several phases:

- Initial PnL-dominant paper reward.
- Temporary entry encouragement so agents would stop no-trading and generate data.
- Heavier penalties for losing money and higher benefits for winning money.
- Efficiency tracking and return-on-risk tracking.
- Lineage-specific reward experiments, including early-entry and exploration lineages.
- Final current direction: keep PnL as the main thing, and use exploration/efficiency terms only as bounded nudges.

The current lesson is that a general PnL reward is not enough unless the training environment makes endgame risk sufficiently visible and expensive.

### Operator Dashboard

The `/rl` page now includes:

- Active BTC market, target, current quote, chance, up/down asks, and current Kalshi URL.
- Live price chart for BTC/YES/NO movement.
- Open positions section above the live agent table.
- Live agent table with active genetic and Molly rows.
- Sortable live agent table across all visible categories.
- Open position side, contracts, paid amount, mark value, and open PnL.
- Return on bankroll, return on money at risk, money gained, money lost, and win/loss counts.
- Agent PnL graph based on run logs and live marks.
- All known agents can be plotted, including deprecated ones, without rendering a giant legend.
- Hover-based lineage visibility for agents and Molly branches.

### Named Lineages

We replaced opaque genome ids in the UI with human-readable names:

- First names vary by individual.
- Last names track lineage/family.
- Hover text exposes parentage, children, generation, and deprecated status.
- This lets the genetic algorithm feel legible without hiding the underlying genome id.

### Molly Pretrained Benchmark Family

We added an isolated pretrained RL path:

- CPU-side pretrained model artifacts live under `.data/kalshi-pretrained-rl`.
- Molly agents use the pretrained checkpoint to emit paper-shadow signals against live orderbook events.
- Molly Parent plus child agents such as Ada, Grace, Hedy, Katherine, and Joan appear in the dashboard.
- Molly agents now behave like other visible agents in the live table.
- A new daemon command keeps Molly refreshing:

```bash
npm run kalshi:pretrained-rl-molly-daemon
```

This fixed the earlier issue where Molly only updated when the one-shot command was manually run.

### Scripts Added

Important scripts now include:

```bash
npm run kalshi:orderbook-capture
npm run kalshi:rl-once
npm run kalshi:rl-daemon
npm run kalshi:pretrained-rl-train
npm run kalshi:pretrained-rl-once
npm run kalshi:pretrained-rl-molly
npm run kalshi:pretrained-rl-molly-daemon
```

### Safety Posture

- No live Kalshi order route was added.
- The Kalshi RL system is paper-only.
- Paper actions are logged to local data and ledger surfaces.
- The pretrained sidecar is isolated from the genetic RL champion/run files.
- Local dashboard polling and daemons operate against localhost.

## What The Latest Behavior Shows

The agent PnL graph showed many agents chugging along profitably until a very recent synchronized drop. We inspected the latest run history and live orderbook marks.

Recent saved generations were still positive:

- Around `05:37Z`, best PnL was about `$296`.
- Around `05:52Z`, best PnL was about `$306`.
- Around `06:07Z`, best PnL was about `$318`.
- Around `06:22Z`, best PnL was about `$295`.

The collapse happened at the far-right live mark, not gradually across the logged history. At that point the live market was extremely one-sided near close:

- YES bid/ask was around `99.9c / 100c`.
- NO bid/ask was around `0c / 0.1c`.
- The market had roughly 30-90 seconds to close.

Any agent carrying wrong-side exposure into that final window gets marked down sharply. This is binary settlement convexity, not normal drift.

## Current Diagnosis

The agents seem to have learned something useful in normal mid-window conditions, but they have not yet learned endgame risk management.

The failure mode is:

1. Many agents trade successfully across most of the window.
2. Their policies are correlated enough that many hold similar exposure.
3. The final minute turns the market into a near-binary certainty.
4. Wrong-side exposure collapses toward zero.
5. The live marked PnL graph drops sharply at the edge.

The dashboard currently mixes historical logged PnL with current live marked PnL in one chart. That is useful for seeing live equity stress, but it should be split into realized PnL and live marked PnL next.

## Recommended Next Experiments

The right long-term answer is not just a permanent hard-coded risk gate. The agents should learn endgame behavior from features and reward pressure.

Recommended lineage experiments:

- Closer line: exits early unless edge is huge.
- Sprinter line: trades only in the last 2 minutes.
- Hedger line: cuts exposure when price crosses against it.
- Conviction line: holds through close only with strong signal.
- Scalper line: closes before the final 60 seconds.

Each lineage should be allowed to compete without deleting the existing strongest families.

## Near-Term Engineering Tasks

1. Split PnL chart into realized PnL and live marked PnL.
2. Add endgame state features:
   - seconds to close
   - distance from target
   - distance velocity
   - quote acceleration
   - current likely settlement side
   - price bucket such as under `10c`, over `90c`, over `98c`
3. Add lineage-specific endgame policy parameters.
4. Add reward terms for correct final-minute risk management:
   - penalize wrong-side exposure near close
   - reward reducing bad exposure before collapse
   - reward profitable late conviction only when it wins
   - prevent cheap lottery spam from hacking the reward
5. Track per-lineage performance over realized windows, not only live marks.

## Bottom Line

The project has moved from "can we ingest and display something" to "can policies learn a difficult binary-market endgame." The core paper-learning infrastructure is now in place. The next frontier is teaching the agents to handle the final minute without hard-coding away the learning problem.
