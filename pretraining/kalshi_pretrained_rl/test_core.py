import gzip
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from kalshi_pretrained_rl.core import Config, build_samples, group_by_market, load_candles, simulate_action_rewards


def candle(market: str, ts: int, mark: float) -> dict:
    spread = 0.04
    return {
        "marketTicker": market,
        "seriesTicker": "KXBTC15M",
        "periodInterval": 1,
        "endPeriodTs": ts,
        "price": {"close": mark},
        "yesBid": {"close": mark - spread / 2},
        "yesAsk": {"close": mark + spread / 2},
        "noBid": {"close": 1 - mark - spread / 2},
        "noAsk": {"close": 1 - mark + spread / 2},
        "volume": 10,
        "openInterest": 20,
    }


def write_history(root: Path, rows: list[dict]) -> None:
    file = root / "candles/period=1m/source=historical/series=KXBTC15M/market=TEST/date=2026-01-01.jsonl.gz"
    file.parent.mkdir(parents=True)
    with gzip.open(file, "wt", encoding="utf8") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")


class KalshiPretrainedRlCoreTests(unittest.TestCase):
    def test_loader_reads_kalshi_history_without_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as raw_tmp:
            tmp = Path(raw_tmp)
            rows = [candle("M1", 1000 + i * 60, 0.5 + i * 0.01) for i in range(6)]
            write_history(tmp, rows)

            loaded = load_candles(tmp, "KXBTC15M", 100)

            self.assertEqual(len(loaded), 6)
            self.assertEqual(loaded[0]["marketTicker"], "M1")

    def test_market_split_is_chronological_and_by_market(self) -> None:
        rows = []
        for market_i in range(5):
            rows.extend(candle(f"M{market_i}", 1000 + market_i * 1000 + i * 60, 0.4 + i * 0.01) for i in range(7))

        samples, splits = build_samples(rows, Config(sequence_minutes=4, max_samples=100))
        grouped = group_by_market(rows)

        self.assertTrue(samples)
        self.assertTrue(splits["train"].isdisjoint(splits["validation"]))
        self.assertTrue(splits["train"].isdisjoint(splits["test"]))
        self.assertLessEqual(
            max(grouped[m][-1]["endPeriodTs"] for m in splits["train"]),
            min(grouped[m][-1]["endPeriodTs"] for m in splits["validation"] | splits["test"]),
        )

    def test_simulator_accounting_rewards_correct_side(self) -> None:
        cfg = Config()
        entry = candle("M1", 1000, 0.5)
        future_up = candle("M1", 1060, 0.6)
        rewards = simulate_action_rewards(entry, future_up, cfg)

        self.assertGreater(rewards[1], 0)
        self.assertGreater(rewards[2], rewards[1])
        self.assertLess(rewards[3], 0)
        self.assertTrue(np.isfinite(rewards).all())


if __name__ == "__main__":
    unittest.main()
