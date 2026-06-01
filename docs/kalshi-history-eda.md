# Kalshi BTC 15M History EDA

Generated: 2026-05-29T20:42:54.346Z

## Coverage

| Metric | Value |
| --- | --- |
| Manifest markets | 16,533 |
| Markets with candles | 10,516 |
| Manifest markets with zero candles | 6,017 |
| One-minute candles | 128,138 |
| Coverage start | 2025-11-13T01:26:00.000Z |
| Coverage end | 2026-05-29T16:21:00.000Z |
| Compressed cache | 14.1 MB |
| Sources | historical, live |

## Candle Counts By Month

| Month | Candles |
| --- | --- |
| 2025-11 | 1,450 |
| 2025-12 | 3,726 |
| 2026-01 | 5,724 |
| 2026-02 | 36,632 |
| 2026-03 | 38,798 |
| 2026-04 | 31,565 |
| 2026-05 | 10,243 |

## Core Distributions

| Distribution | Count | Mean | P05 | P25 | Median | P75 | P95 | P99 | Max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Close price | 45,680 | 0.5097 | 0.02 | 0.38 | 0.51 | 0.65 | 0.95 | 0.99 | 0.999 |
| First close per market | 7,911 | 0.5169 | 0.08 | 0.46 | 0.51 | 0.59 | 0.93 | 0.99 | 0.999 |
| Final close per market | 7,911 | 0.5165 | 0.02 | 0.36 | 0.51 | 0.7 | 0.98 | 0.99 | 0.999 |
| Bid/ask spread | 128,138 | 0.3597 | 0.01 | 0.04 | 0.25 | 0.53 | 1 | 1 | 1 |
| Candle volume | 128,138 | 10.8812 | 0 | 0 | 0 | 2 | 27 | 120 | 267,190 |
| Open interest | 128,138 | 45.046 | 0 | 0 | 3 | 16 | 133 | 360 | 479,185 |
| Candles per market | 10,516 | 12.1851 | 2 | 5 | 11 | 15 | 30 | 56 | 388 |
| Market span minutes | 10,516 | 49.2534 | 2 | 12 | 15 | 15 | 122.25 | 1,139.7 | 1,602 |
| Missing minutes per market | 10,516 | 40.1639 | 0 | 0 | 3 | 9 | 103 | 1,128.7 | 1,585 |
| First-to-last move | 7,911 | -0.0004 | -0.47 | -0.06 | 0 | 0.08 | 0.47 | 0.6672 | 0.98 |
| In-market price range | 7,911 | 0.2442 | 0 | 0 | 0.17 | 0.43 | 0.76 | 0.98 | 0.998 |

## Data Quality

| Check | Value |
| --- | --- |
| Candles missing price close | 82,458 |
| Candles missing bid or ask close | 0 |
| Close prices outside [0, 1] | 0 |
| Candles with volume | 128,138 |
| Candles with open interest | 128,138 |
| Dense markets, >=12 candles | 5,016 |
| Dense market share | 47.7% |

## Training Evidence

| Metric | Value |
| --- | --- |
| Sample size | 8,939 |
| Horizon minutes | 15 |
| Markets represented | 6,870 |
| Evidence source | kalshi-history:ca3c89736c |
| Create sample median | 0 |
| Decay sample median | 0.4849 |

## Highest Volume Markets

| Market | Candles | Start | End | Total Volume | First Close | Last Close |
| --- | --- | --- | --- | --- | --- | --- |
| KXBTC15M-26MAY022245-45 | 68 | 2026-05-03T00:53:00.000Z | 2026-05-03T02:46:00.000Z | 479,316 | 0.48 | 0.94 |
| KXBTC15M-26MAR151345-45 | 9 | 2026-03-15T17:31:00.000Z | 2026-03-15T17:45:00.000Z | 55,019 | 0.46 | 0.45 |
| KXBTC15M-26MAY200300-00 | 4 | 2026-05-20T06:46:00.000Z | 2026-05-20T07:00:00.000Z | 50,262 | 0.45 | 0.45 |
| KXBTC15M-26MAR081015-15 | 20 | 2026-03-08T14:04:00.000Z | 2026-03-08T14:16:00.000Z | 11,050 | 0.01 | 0.89 |
| KXBTC15M-26MAR161715-15 | 5 | 2026-03-16T21:01:00.000Z | 2026-03-16T21:15:00.000Z | 4,764 | 0.5 | 0.45 |
| KXBTC15M-26MAR071130-30 | 10 | 2026-03-07T16:25:00.000Z | 2026-03-07T16:31:00.000Z | 4,594 | 0.14 | 0.14 |
| KXBTC15M-26MAR061645-45 | 18 | 2026-03-06T21:33:00.000Z | 2026-03-06T21:46:00.000Z | 3,626 | 0.52 | 0.32 |
| KXBTC15M-26MAR021445-45 | 26 | 2026-03-02T19:31:00.000Z | 2026-03-02T19:46:00.000Z | 3,382 | 0.58 | 0.3 |

## Busiest Days

| Day | Candles |
| --- | --- |
| 2026-03-13 | 4,948 |
| 2026-02-12 | 4,226 |
| 2026-02-13 | 3,312 |
| 2026-02-11 | 3,202 |
| 2025-12-30 | 2,468 |
| 2026-02-10 | 2,414 |
| 2026-02-04 | 1,936 |
| 2026-03-11 | 1,792 |
| 2026-03-10 | 1,772 |
| 2026-03-02 | 1,764 |
| 2026-02-03 | 1,762 |
| 2026-02-06 | 1,564 |
| 2026-03-12 | 1,564 |
| 2026-02-08 | 1,518 |
| 2026-02-09 | 1,502 |
