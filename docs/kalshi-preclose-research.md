# Kalshi BTC 0-60 Minute Pre-Close Research

Generated: 2026-05-29T21:02:31.840Z

This report studies only rows from 0 to 60 minutes before the parsed Kalshi market close. Mark price is trade close when present, otherwise yes bid/ask midpoint.

## Scope

| Metric | Value |
| --- | --- |
| Rows | 111,314 |
| Markets | 10,360 |
| Clean rows, spread <= 5c | 32,857 |
| Clean row share | 29.5% |
| Rows with volume or OI | 76,735 |
| Liquid row share | 68.9% |

## Lifecycle Inside 60 Minutes

| Bucket | Rows | Mark Med | Spread Med | Vol Med | Clean Share | Trade Close Share |
| --- | --- | --- | --- | --- | --- | --- |
| 31-60 | 3,698 | 0.5 | 0.02 | 0 | 69.8% | 10.1% |
| 16-30 | 1,878 | 0.5 | 0.02 | 0 | 66.3% | 12.6% |
| 11-15 | 33,342 | 0.505 | 0.32 | 0 | 26.7% | 43.3% |
| 06-10 | 35,957 | 0.525 | 0.17 | 0 | 30% | 41.8% |
| 04-05 | 13,335 | 0.52 | 0.16 | 0 | 29.6% | 39.8% |
| 02-03 | 12,480 | 0.51 | 0.18 | 0 | 30% | 38.3% |
| 01 | 5,689 | 0.505 | 0.2 | 0 | 28.9% | 40% |
| 00 close | 4,935 | 0.5 | 0.41 | 0 | 19% | 34.4% |

## Forward Movement

| Subset | Horizon | Samples | Mean Delta | Median Delta | Abs Med | Up Share | Mean Spread |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All | 1m | 81,191 | 0.0013 | 0 | 0.03 | 50.4% | 0.2693 |
| All | 10m | 25,360 | -0.002 | 0 | 0.15 | 49.7% | 0.2766 |
| All | 15m | 3,026 | 0.0035 | 0 | 0 | 58.2% | 0.1338 |
| All | 3m | 64,576 | 0.0013 | 0 | 0.07 | 50.1% | 0.2698 |
| All | 5m | 52,386 | -0.0002 | 0 | 0.1 | 49.7% | 0.2723 |
| Spread <=5c | 1m | 27,341 | 0.0032 | 0 | 0.01 | 51% | 0.0223 |
| Spread <=5c | 10m | 9,093 | 0.0065 | 0 | 0.05 | 51% | 0.0219 |
| Spread <=5c | 15m | 2,216 | 0.0013 | 0 | 0 | 55.8% | 0.0211 |
| Spread <=5c | 3m | 21,451 | 0.0062 | 0 | 0.025 | 51% | 0.0223 |
| Spread <=5c | 5m | 17,515 | 0.0062 | 0 | 0.04 | 51.2% | 0.0223 |
| Clean + liquid | 1m | 19,288 | 0.0025 | 0 | 0.015 | 50.2% | 0.0222 |
| Clean + liquid | 10m | 5,266 | -0.001 | 0 | 0.16 | 49.2% | 0.0215 |
| Clean + liquid | 15m | 337 | 0.0188 | 0 | 0.01 | 49% | 0.0228 |
| Clean + liquid | 3m | 15,047 | 0.0031 | 0 | 0.05 | 49.8% | 0.0221 |
| Clean + liquid | 5m | 11,966 | -0.0004 | 0 | 0.08 | 49.5% | 0.022 |

## 5-Minute Forward Movement By Start Time

| 5m Start Bucket | Samples | Mean Delta | Median Delta | Abs Med | Up Share | Mean Spread |
| --- | --- | --- | --- | --- | --- | --- |
| 04-05 | 3,585 | -0.0097 | 0 | 0.109 | 47.1% | 0.2644 |
| 06-10 | 23,749 | -0.0061 | 0 | 0.1 | 48.4% | 0.2645 |
| 11-15 | 21,834 | 0.0081 | 0 | 0.13 | 51.3% | 0.3052 |
| 16-30 | 1,114 | -0.0125 | 0 | 0 | 44.2% | 0.147 |
| 31-60 | 2,104 | 0.0029 | 0 | 0 | 72.9% | 0.099 |

## 5-Minute Forward Movement By Starting Price

| 5m Start Price | Samples | All Mean | All Up | Clean Samples | Clean Mean | Clean Up |
| --- | --- | --- | --- | --- | --- | --- |
| 00-05 | 1,826 | 0.239 | 86.7% | 1,158 | 0.1875 | 87.4% |
| 05-15 | 1,999 | 0.1235 | 53.8% | 479 | 0.0862 | 47.5% |
| 15-35 | 6,908 | 0.107 | 61.6% | 1,428 | 0.0477 | 49.5% |
| 35-65 | 25,443 | 0.0069 | 52.3% | 10,606 | 0.0102 | 53.9% |
| 65-85 | 10,648 | -0.0839 | 37.9% | 2,048 | -0.0435 | 46.7% |
| 85-95 | 2,985 | -0.0998 | 42.6% | 539 | -0.0948 | 40.8% |
| 95-100 | 2,577 | -0.1611 | 19% | 1,257 | -0.1482 | 13.9% |

## Spread Regimes

| Spread Bucket | Rows | Share | Mark Median | Volume Median |
| --- | --- | --- | --- | --- |
| <=02c | 14,275 | 12.8% | 0.505 | 0 |
| >50c | 23,475 | 21.1% | 0.5 | 0 |
| 02-05c | 19,518 | 17.5% | 0.5 | 0 |
| 05-10c | 11,416 | 10.3% | 0.58 | 0 |
| 10-25c | 14,831 | 13.3% | 0.55 | 0 |
| 25-50c | 27,799 | 25% | 0.56 | 0 |

## Irregularities

| Metric | Value |
| --- | --- |
| Gap count >1 minute | 11,334 |
| Gap median minutes | 3 |
| Gap P95 minutes | 10 |
| Market range median | 0.33 |
| Market range P95 | 0.82 |
| Market median-spread median | 0.33 |

## High-Range Examples

| Market | Candles | Range | First | Last | Vol | Med Spread | Max Gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KXBTC15M-26MAY271115-15 | 7 | 0.998 | 0.025 | 0.88 | 19 | 0.05 | 3 |
| KXBTC15M-26JAN112000-00 | 26 | 0.99 | 0.005 | 0.995 | 82 | 0.01 | 2 |
| KXBTC15M-26JAN112200-00 | 20 | 0.99 | 0.995 | 0.005 | 28 | 0.01 | 3 |
| KXBTC15M-26JAN291945-45 | 14 | 0.99 | 0.995 | 0.005 | 0 | 0.5 | 4 |
| KXBTC15M-26FEB201730-30 | 12 | 0.99 | 0.005 | 0.99 | 84 | 0.015 | 6 |
| KXBTC15M-26APR280100-00 | 4 | 0.99 | 0.005 | 0.99 | 12 | 0.24 | 8 |
| KXBTC15M-26MAY120715-15 | 6 | 0.99 | 0.78 | 0.005 | 6 | 0.01 | 2 |
| KXBTC15M-26MAY132015-15 | 11 | 0.99 | 0.235 | 0.995 | 217 | 0.01 | 4 |

## Initial Read

- The 0-60 minute window is not homogeneous: 31-60 and 16-30 minute rows are much cleaner than close/settlement rows.
- Raw all-row forward deltas are close to balanced, which argues against a simple unconditional drift edge.
- Spread filtering matters more than horizon choice. The clean subset has far fewer samples but much lower friction.
- Starting price region has visible boundary effects: low marks more often move up, high marks more often move down, consistent with quote bounce and bounded [0,1] pricing.
- The best next predictive research should model conditional movement only on clean rows and should treat close-bucket rows as settlement artifacts unless independently verified.