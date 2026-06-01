# Kalshi BTC 15M Market Mechanics

Generated: 2026-05-29T20:53:17.165Z

This report uses a mark price equal to trade close when Kalshi provides it, otherwise the yes bid/ask midpoint. That lets us study quote movement across the full local candle cache instead of only the subset with trade-close candles.

## Headline Mechanics

| Metric | Value |
| --- | --- |
| 1m move median | 0 |
| 1m move P05/P95 | -0.2697 / 0.265 |
| Abs 1m move median | 0.005 |
| Abs 1m move P95 | 0.4 |
| Path first-to-last median | 0 |
| Path absolute move median | 0.22 |
| Path range median | 0.405 |
| Final mark within 5c of 0/1 | 8% |
| 1m autocorrelation | -0.1931 |
| Positive signed move share | 49.6% |

## Lifecycle Shape

| Minutes To Close | Candles | Mark Median | Spread Median | Volume Median | Trade Close Share |
| --- | --- | --- | --- | --- | --- |
| 4-24h | 4,345 | 0.505 | 0.96 | 0 | 19.6% |
| 1-4h | 4,627 | 0.65 | 0.15 | 0 | 14.6% |
| 31-60 | 3,698 | 0.5 | 0.02 | 0 | 10.1% |
| 16-30 | 1,878 | 0.5 | 0.02 | 0 | 12.6% |
| 11-15 | 33,342 | 0.505 | 0.32 | 0 | 43.3% |
| 6-10 | 35,957 | 0.525 | 0.17 | 0 | 41.8% |
| 4-5 | 13,335 | 0.52 | 0.16 | 0 | 39.8% |
| 2-3 | 12,480 | 0.51 | 0.18 | 0 | 38.3% |
| 1 | 5,689 | 0.505 | 0.2 | 0 | 40% |
| 0 close | 12,449 | 0.5 | 1 | 0 | 13.6% |
| after close | 229 | 0.5 | 1 | 0 | 0.4% |

## Mean Reversion And Continuation

| Previous Move Size | Reversal Share | Reversals | Continuations |
| --- | --- | --- | --- |
| 1-3c | 56.8% | 3,630 | 2,763 |
| 10-20c | 59.2% | 3,702 | 2,554 |
| 3-5c | 54.6% | 2,311 | 1,922 |
| 5-10c | 55.8% | 3,204 | 2,536 |
| >=20c | 66.5% | 6,051 | 3,050 |
| flat <1c | 51.7% | 1,158 | 1,081 |

## Movement By Price Region

| Starting Mark | Up | Down | Flat | Up Share | Down Share |
| --- | --- | --- | --- | --- | --- |
| 00-05 | 2,063 | 411 | 3,396 | 35.1% | 7% |
| 05-15 | 1,772 | 1,274 | 1,353 | 40.3% | 29% |
| 15-35 | 5,878 | 3,297 | 5,436 | 40.2% | 22.6% |
| 35-65 | 13,387 | 12,606 | 28,871 | 24.4% | 23% |
| 65-85 | 4,473 | 8,030 | 9,094 | 20.7% | 37.2% |
| 85-95 | 1,705 | 2,375 | 3,020 | 24% | 33.5% |
| 95-100 | 738 | 2,496 | 5,947 | 8% | 27.2% |

## Irregularities

| Check | Value |
| --- | --- |
| Rows after parsed market close | 229 |
| Rows with crossed or >95c spread | 19,784 |
| Gap count >1 minute | 16,973 |
| Gap median minutes | 3 |
| Gap P95 minutes | 104 |
| Gap max minutes | 1,335 |

## Largest Path Ranges

| Market | Candles | Range | First | Last | Max Step | Max Gap | Volume |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KXBTC15M-26MAY271115-15 | 7 | 0.998 | 0.025 | 0.88 | 0.998 | 3 | 19 |
| KXBTC15M-26JAN112000-00 | 28 | 0.99 | 0.005 | 0.5 | 0.985 | 2 | 82 |
| KXBTC15M-26JAN112200-00 | 22 | 0.99 | 0.995 | 0.5 | 0.545 | 4 | 28 |
| KXBTC15M-26JAN291945-45 | 16 | 0.99 | 0.995 | 0.5 | 0.99 | 6 | 0 |
| KXBTC15M-26FEB201730-30 | 14 | 0.99 | 0.005 | 0.5 | 0.545 | 6 | 84 |
| KXBTC15M-26APR280100-00 | 4 | 0.99 | 0.005 | 0.99 | 0.985 | 8 | 12 |
| KXBTC15M-26MAY120715-15 | 6 | 0.99 | 0.78 | 0.005 | 0.525 | 2 | 6 |
| KXBTC15M-26MAY132015-15 | 11 | 0.99 | 0.235 | 0.995 | 0.985 | 4 | 217 |

## Interpretation

- The generalized mark is centered near 50c, but individual paths are jumpy: median path range is materially larger than the median one-minute move.
- One-minute movement has near-zero median, so most raw candle-to-candle changes are noise or unchanged quotes.
- Reversal shares above 50% after non-flat moves are evidence of microstructure bounce, especially when spreads are wide.
- Wide spreads and sparse paths mean naive trend following on all candles would mostly model liquidity/friction, not clean directional edge.
- Dense, low-spread, nonzero-volume paths should be the first research subset for any predictive study.