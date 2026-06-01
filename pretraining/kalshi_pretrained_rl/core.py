from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
import random
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F


FEATURE_NAMES = [
    "mark",
    "yes_bid",
    "yes_ask",
    "no_bid",
    "no_ask",
    "spread",
    "volume_log",
    "open_interest_log",
    "market_progress",
    "minute_gap",
    "return_1m",
]

ACTION_NAMES = ["flat", "yes_small", "yes_full", "no_small", "no_full"]
MODEL_PREFIX = "kalshi-pretrained-rl"


@dataclass(frozen=True)
class Config:
    series: str = "KXBTC15M"
    sequence_minutes: int = 32
    d_model: int = 64
    heads: int = 4
    layers: int = 3
    dropout: float = 0.1
    seed: int = 1977
    pretrain_epochs: int = 1
    rl_epochs: int = 1
    batch_size: int = 64
    max_samples: int = 4096
    max_candles: int = 120_000
    fee_rate: float = 0.004
    small_notional: float = 10.0
    full_notional: float = 25.0


@dataclass(frozen=True)
class SequenceSample:
    market: str
    end_ts: int
    x: np.ndarray
    future_return: float
    action_rewards: np.ndarray
    entry_mark: float
    future_mark: float


@dataclass(frozen=True)
class InferenceSample:
    market: str
    end_ts: int
    x: np.ndarray
    entry_mark: float


def repo_root() -> Path:
    return Path.cwd()


def history_dir() -> Path:
    raw = os.environ.get("KALSHI_HISTORY_DATA_DIR", "").strip()
    return Path(raw) if raw else repo_root() / ".data" / "kalshi-history"


def artifact_dir() -> Path:
    raw = os.environ.get("KALSHI_PRETRAINED_RL_DATA_DIR", "").strip()
    return Path(raw) if raw else repo_root() / ".data" / "kalshi-pretrained-rl"


def env_int(name: str, fallback: int) -> int:
    try:
        value = int(os.environ.get(name, ""))
        return value if value > 0 else fallback
    except ValueError:
        return fallback


def config_from_env() -> Config:
    return Config(
        series=os.environ.get("KALSHI_PRETRAINED_RL_SERIES", "KXBTC15M").strip() or "KXBTC15M",
        sequence_minutes=env_int("KALSHI_PRETRAINED_RL_SEQUENCE_MINUTES", 32),
        max_samples=env_int("KALSHI_PRETRAINED_RL_MAX_SAMPLES", 4096),
        max_candles=env_int("KALSHI_PRETRAINED_RL_MAX_CANDLES", 120_000),
        pretrain_epochs=env_int("KALSHI_PRETRAINED_RL_PRETRAIN_EPOCHS", 1),
        rl_epochs=env_int("KALSHI_PRETRAINED_RL_RL_EPOCHS", 1),
        batch_size=env_int("KALSHI_PRETRAINED_RL_BATCH_SIZE", 64),
    )


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def read_jsonl_gz(path: Path) -> Iterable[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def close_value(raw: Any) -> float | None:
    if not isinstance(raw, dict):
        return None
    value = raw.get("close")
    if value is None:
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def bounded(value: float | None, lo: float, hi: float) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return max(lo, min(hi, value))


def mark_for(candle: dict[str, Any]) -> float | None:
    price = close_value(candle.get("price"))
    if price is not None:
        return bounded(price, 0.0005, 0.9995)
    bid = close_value(candle.get("yesBid"))
    ask = close_value(candle.get("yesAsk"))
    if bid is None or ask is None:
        return None
    return bounded((bid + ask) / 2, 0.0005, 0.9995)


def candle_feature(candle: dict[str, Any], first_ts: int, last_ts: int, prev_mark: float | None) -> tuple[np.ndarray, float] | None:
    mark = mark_for(candle)
    if mark is None:
        return None
    yes_bid = bounded(close_value(candle.get("yesBid")), 0.0, 1.0)
    yes_ask = bounded(close_value(candle.get("yesAsk")), 0.0, 1.0)
    no_bid = bounded(close_value(candle.get("noBid")), 0.0, 1.0)
    no_ask = bounded(close_value(candle.get("noAsk")), 0.0, 1.0)
    if yes_bid is None or yes_ask is None:
        spread = 0.05
        yes_bid = max(0.0, mark - spread / 2)
        yes_ask = min(1.0, mark + spread / 2)
    if no_bid is None:
        no_bid = max(0.0, 1.0 - yes_ask)
    if no_ask is None:
        no_ask = min(1.0, 1.0 - yes_bid)
    spread = max(0.0, yes_ask - yes_bid)
    volume = float(candle.get("volume") or 0.0)
    open_interest = float(candle.get("openInterest") or 0.0)
    ts = int(candle["endPeriodTs"])
    span = max(60, last_ts - first_ts)
    progress = max(0.0, min(1.0, (ts - first_ts) / span))
    minute_gap = max(0.0, min(10.0, (ts - first_ts) / 60.0)) / 10.0
    ret = 0.0 if prev_mark is None else max(-1.0, min(1.0, mark / max(prev_mark, 0.01) - 1.0))
    return (
        np.array(
            [
                mark,
                yes_bid,
                yes_ask,
                no_bid,
                no_ask,
                spread,
                math.log1p(max(0.0, volume)),
                math.log1p(max(0.0, open_interest)),
                progress,
                minute_gap,
                ret,
            ],
            dtype=np.float32,
        ),
        mark,
    )


def simulate_action_rewards(entry: dict[str, Any], future: dict[str, Any], cfg: Config) -> np.ndarray:
    yes_entry = bounded(close_value(entry.get("yesAsk")), 0.0005, 0.9995) or mark_for(entry) or 0.5
    yes_exit = bounded(close_value(future.get("yesBid")), 0.0005, 0.9995) or mark_for(future) or yes_entry
    no_entry = bounded(close_value(entry.get("noAsk")), 0.0005, 0.9995) or max(0.0005, 1.0 - yes_entry)
    no_exit = bounded(close_value(future.get("noBid")), 0.0005, 0.9995) or max(0.0005, 1.0 - yes_exit)

    def pnl(notional: float, entry_price: float, exit_price: float) -> float:
        contracts = notional / max(entry_price, 0.01)
        return contracts * (exit_price - entry_price) - notional * cfg.fee_rate

    churn = 0.02
    return np.array(
        [
            0.0,
            pnl(cfg.small_notional, yes_entry, yes_exit) - churn,
            pnl(cfg.full_notional, yes_entry, yes_exit) - churn,
            pnl(cfg.small_notional, no_entry, no_exit) - churn,
            pnl(cfg.full_notional, no_entry, no_exit) - churn,
        ],
        dtype=np.float32,
    )


def load_candles(root: Path, series: str, max_candles: int) -> list[dict[str, Any]]:
    candle_root = root / "candles"
    files = sorted(candle_root.rglob("*.jsonl.gz")) if candle_root.exists() else []
    candles: list[dict[str, Any]] = []
    for file in files:
        if f"series={series}" not in str(file):
            continue
        for candle in read_jsonl_gz(file):
            if candle.get("periodInterval") != 1:
                continue
            if candle.get("seriesTicker") not in (series, None):
                continue
            if "endPeriodTs" not in candle or not candle.get("marketTicker"):
                continue
            candles.append(candle)
            if len(candles) >= max_candles:
                return candles
    return candles


def group_by_market(candles: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for candle in candles:
        grouped.setdefault(str(candle["marketTicker"]), []).append(candle)
    for rows in grouped.values():
        rows.sort(key=lambda row: int(row["endPeriodTs"]))
    return grouped


def split_markets(grouped: dict[str, list[dict[str, Any]]]) -> dict[str, set[str]]:
    ordered = sorted(
        grouped.items(),
        key=lambda item: (int(item[1][-1]["endPeriodTs"]) if item[1] else 0, item[0]),
    )
    markets = [market for market, rows in ordered if len(rows) >= 2]
    n = len(markets)
    train_end = max(1, int(n * 0.7))
    val_end = max(train_end + 1, int(n * 0.85)) if n > 2 else n
    return {
        "train": set(markets[:train_end]),
        "validation": set(markets[train_end:val_end]),
        "test": set(markets[val_end:]),
    }


def build_samples(candles: list[dict[str, Any]], cfg: Config) -> tuple[list[SequenceSample], dict[str, set[str]]]:
    grouped = group_by_market(candles)
    splits = split_markets(grouped)
    samples: list[SequenceSample] = []
    for market, rows in grouped.items():
        if len(rows) <= cfg.sequence_minutes:
            continue
        first_ts = int(rows[0]["endPeriodTs"])
        last_ts = int(rows[-1]["endPeriodTs"])
        features: list[np.ndarray] = []
        marks: list[float] = []
        prev_mark: float | None = None
        usable_rows: list[dict[str, Any]] = []
        for row in rows:
            parsed = candle_feature(row, first_ts, last_ts, prev_mark)
            if parsed is None:
                continue
            feature, mark = parsed
            features.append(feature)
            marks.append(mark)
            usable_rows.append(row)
            prev_mark = mark
        if len(features) <= cfg.sequence_minutes:
            continue
        for i in range(cfg.sequence_minutes - 1, len(features) - 1):
            window = np.stack(features[i - cfg.sequence_minutes + 1 : i + 1])
            future_return = max(-1.0, min(1.0, marks[i + 1] / max(marks[i], 0.01) - 1.0))
            samples.append(
                SequenceSample(
                    market=market,
                    end_ts=int(usable_rows[i]["endPeriodTs"]),
                    x=window,
                    future_return=float(future_return),
                    action_rewards=simulate_action_rewards(usable_rows[i], usable_rows[i + 1], cfg),
                    entry_mark=marks[i],
                    future_mark=marks[i + 1],
                )
            )
    samples.sort(key=lambda s: (s.end_ts, s.market))
    return samples, splits


def inference_sample_from_candles(candles: list[dict[str, Any]], cfg: Config) -> InferenceSample | None:
    grouped = group_by_market(candles)
    best: InferenceSample | None = None
    for market, rows in grouped.items():
        if len(rows) < cfg.sequence_minutes:
            continue
        first_ts = int(rows[0]["endPeriodTs"])
        last_ts = int(rows[-1]["endPeriodTs"])
        features: list[np.ndarray] = []
        marks: list[float] = []
        prev_mark: float | None = None
        usable_rows: list[dict[str, Any]] = []
        for row in rows:
            parsed = candle_feature(row, first_ts, last_ts, prev_mark)
            if parsed is None:
                continue
            feature, mark = parsed
            features.append(feature)
            marks.append(mark)
            usable_rows.append(row)
            prev_mark = mark
        if len(features) < cfg.sequence_minutes:
            continue
        sample = InferenceSample(
            market=market,
            end_ts=int(usable_rows[-1]["endPeriodTs"]),
            x=np.stack(features[-cfg.sequence_minutes:]),
            entry_mark=marks[-1],
        )
        if best is None or (sample.end_ts, sample.market) > (best.end_ts, best.market):
            best = sample
    return best


def event_to_candle(event: dict[str, Any]) -> dict[str, Any] | None:
    market = event.get("marketTicker")
    received_at = event.get("receivedAt")
    if not isinstance(market, str) or not isinstance(received_at, str):
        return None
    try:
        end_ts = int(datetime.fromisoformat(received_at.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp())
    except (TypeError, ValueError):
        return None

    def ohlc(value: Any) -> dict[str, float | None]:
        try:
            n = float(value) if value is not None else None
        except (TypeError, ValueError):
            n = None
        return {"close": n}

    yes_bid = event.get("yesBid")
    yes_ask = event.get("yesAsk")
    mark = event.get("tradedPrice")
    if mark is None and yes_bid is not None and yes_ask is not None:
        try:
            mark = (float(yes_bid) + float(yes_ask)) / 2
        except (TypeError, ValueError):
            mark = None
    return {
        "marketTicker": market,
        "seriesTicker": event.get("seriesTicker") or "KXBTC15M",
        "periodInterval": 1,
        "endPeriodTs": end_ts,
        "price": ohlc(mark),
        "yesBid": ohlc(yes_bid),
        "yesAsk": ohlc(yes_ask),
        "noBid": ohlc(event.get("noBid")),
        "noAsk": ohlc(event.get("noAsk")),
        "volume": event.get("tradedQuantity") or 0,
        "openInterest": min(float(event.get("yesDepth") or 0), float(event.get("noDepth") or 0)),
    }


def split_samples(samples: list[SequenceSample], splits: dict[str, set[str]]) -> dict[str, list[SequenceSample]]:
    return {name: [sample for sample in samples if sample.market in markets] for name, markets in splits.items()}


def limit_split_samples(split: dict[str, list[SequenceSample]], max_samples: int) -> dict[str, list[SequenceSample]]:
    if max_samples <= 0:
        return split
    budgets = {
        "train": max(1, int(max_samples * 0.7)),
        "validation": max(1, int(max_samples * 0.15)),
        "test": max(1, max_samples - max(1, int(max_samples * 0.7)) - max(1, int(max_samples * 0.15))),
    }
    limited: dict[str, list[SequenceSample]] = {}
    for name, rows in split.items():
        budget = budgets.get(name, max_samples)
        if len(rows) <= budget:
            limited[name] = rows
            continue
        step = max(1, len(rows) // budget)
        limited[name] = rows[::step][:budget]
    return limited


def normalization(samples: list[SequenceSample]) -> dict[str, list[float]]:
    if not samples:
        mean = np.zeros(len(FEATURE_NAMES), dtype=np.float32)
        std = np.ones(len(FEATURE_NAMES), dtype=np.float32)
    else:
        arr = np.concatenate([sample.x for sample in samples], axis=0)
        mean = arr.mean(axis=0)
        std = arr.std(axis=0)
        std = np.where(std < 1e-6, 1.0, std)
    return {"mean": mean.astype(float).tolist(), "std": std.astype(float).tolist()}


def tensorize(samples: list[SequenceSample], norm: dict[str, list[float]]) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    if not samples:
        return (
            torch.zeros((0, len(norm["mean"]), len(FEATURE_NAMES)), dtype=torch.float32),
            torch.zeros((0,), dtype=torch.float32),
            torch.zeros((0, len(ACTION_NAMES)), dtype=torch.float32),
        )
    mean = np.asarray(norm["mean"], dtype=np.float32)
    std = np.asarray(norm["std"], dtype=np.float32)
    x = np.stack([(sample.x - mean) / std for sample in samples]).astype(np.float32)
    returns = np.asarray([sample.future_return for sample in samples], dtype=np.float32)
    rewards = np.stack([sample.action_rewards for sample in samples]).astype(np.float32)
    return torch.from_numpy(x), torch.from_numpy(returns), torch.from_numpy(rewards)


class MarketTransformer(nn.Module):
    def __init__(self, input_dim: int, cfg: Config):
        super().__init__()
        self.cfg = cfg
        self.input = nn.Linear(input_dim, cfg.d_model)
        self.pos = nn.Parameter(torch.zeros(1, cfg.sequence_minutes, cfg.d_model))
        layer = nn.TransformerEncoderLayer(
            d_model=cfg.d_model,
            nhead=cfg.heads,
            dim_feedforward=cfg.d_model * 4,
            dropout=cfg.dropout,
            batch_first=True,
            activation="gelu",
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=cfg.layers)
        self.reconstruct = nn.Linear(cfg.d_model, input_dim)
        self.return_head = nn.Linear(cfg.d_model, 1)
        self.actor = nn.Linear(cfg.d_model, len(ACTION_NAMES))
        self.value = nn.Linear(cfg.d_model, 1)

    def forward(self, x: torch.Tensor) -> dict[str, torch.Tensor]:
        h = self.input(x) + self.pos[:, : x.shape[1], :]
        encoded = self.encoder(h)
        pooled = encoded[:, -1, :]
        return {
            "encoded": encoded,
            "pooled": pooled,
            "reconstruction": self.reconstruct(encoded),
            "return": self.return_head(pooled).squeeze(-1),
            "logits": self.actor(pooled),
            "value": self.value(pooled).squeeze(-1),
        }


def batches(n: int, batch_size: int, seed: int) -> Iterable[np.ndarray]:
    rng = np.random.default_rng(seed)
    indexes = np.arange(n)
    rng.shuffle(indexes)
    for start in range(0, n, batch_size):
        yield indexes[start : start + batch_size]


def train_pretrain(model: MarketTransformer, x: torch.Tensor, returns: torch.Tensor, cfg: Config) -> list[float]:
    if len(x) == 0:
        return []
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
    losses: list[float] = []
    model.train()
    for epoch in range(cfg.pretrain_epochs):
        for idx in batches(len(x), cfg.batch_size, cfg.seed + epoch):
            xb = x[idx]
            rb = returns[idx]
            mask = torch.rand_like(xb[..., :1]) < 0.15
            masked = xb.masked_fill(mask, 0.0)
            out = model(masked)
            recon = out["reconstruction"]
            recon_loss = F.mse_loss(recon[mask.expand_as(xb)], xb[mask.expand_as(xb)]) if mask.any() else F.mse_loss(recon, xb)
            return_loss = F.smooth_l1_loss(out["return"], rb)
            direction_loss = F.binary_cross_entropy_with_logits(out["return"] * 20.0, (rb > 0).float())
            loss = recon_loss + return_loss + 0.2 * direction_loss
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
    return losses


def train_policy(model: MarketTransformer, x: torch.Tensor, action_rewards: torch.Tensor, cfg: Config) -> list[float]:
    if len(x) == 0:
        return []
    optimizer = torch.optim.AdamW(model.parameters(), lr=5e-4, weight_decay=1e-4)
    losses: list[float] = []
    model.train()
    for epoch in range(cfg.rl_epochs):
        for idx in batches(len(x), cfg.batch_size, cfg.seed + 100 + epoch):
            xb = x[idx]
            rewards_by_action = action_rewards[idx]
            with torch.no_grad():
                old_out = model(xb)
                old_dist = torch.distributions.Categorical(logits=old_out["logits"])
                actions = old_dist.sample()
                old_logp = old_dist.log_prob(actions)
                rewards = rewards_by_action.gather(1, actions[:, None]).squeeze(1)
            out = model(xb)
            dist = torch.distributions.Categorical(logits=out["logits"])
            logp = dist.log_prob(actions)
            values = out["value"]
            advantage = rewards - values.detach()
            ratio = torch.exp(logp - old_logp)
            clipped = torch.clamp(ratio, 0.8, 1.2) * advantage
            policy_loss = -torch.min(ratio * advantage, clipped).mean()
            value_loss = F.smooth_l1_loss(values, rewards)
            entropy = dist.entropy().mean()
            loss = policy_loss + 0.5 * value_loss - 0.01 * entropy
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
    return losses


def evaluate_policy(model: MarketTransformer, x: torch.Tensor, action_rewards: torch.Tensor) -> dict[str, Any]:
    if len(x) == 0:
        return {
            "samples": 0,
            "avgReward": 0.0,
            "totalReward": 0.0,
            "trades": 0,
            "actionCounts": {name: 0 for name in ACTION_NAMES},
        }
    model.eval()
    with torch.no_grad():
        out = model(x)
        actions = out["logits"].argmax(dim=1)
        rewards = action_rewards.gather(1, actions[:, None]).squeeze(1)
    counts = {name: int((actions == i).sum().item()) for i, name in enumerate(ACTION_NAMES)}
    trades = int(sum(count for name, count in counts.items() if name != "flat"))
    total = float(rewards.sum().item())
    return {
        "samples": int(len(x)),
        "avgReward": total / max(1, len(x)),
        "totalReward": total,
        "trades": trades,
        "actionCounts": counts,
    }


def model_id() -> str:
    return f"{MODEL_PREFIX}-{int(time.time() * 1000):x}"


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf8")
    tmp.replace(path)


def read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf8"))
    except FileNotFoundError:
        return fallback


def checkpoint_payload(model: MarketTransformer, cfg: Config, norm: dict[str, list[float]], metadata: dict[str, Any]) -> dict[str, Any]:
    return {
        "state_dict": model.state_dict(),
        "config": cfg.__dict__,
        "normalization": norm,
        "feature_names": FEATURE_NAMES,
        "action_names": ACTION_NAMES,
        "metadata": metadata,
    }


def load_checkpoint(path: Path) -> tuple[MarketTransformer, Config, dict[str, list[float]], dict[str, Any]]:
    payload = torch.load(path, map_location="cpu", weights_only=False)
    cfg = Config(**payload["config"])
    model = MarketTransformer(len(payload.get("feature_names", FEATURE_NAMES)), cfg)
    model.load_state_dict(payload["state_dict"])
    model.eval()
    return model, cfg, payload["normalization"], payload.get("metadata", {})


def run_train(args: argparse.Namespace) -> dict[str, Any]:
    cfg = config_from_env()
    if args.max_samples:
        cfg = Config(**{**cfg.__dict__, "max_samples": args.max_samples})
    set_seed(cfg.seed)
    hdir = Path(args.history_dir) if args.history_dir else history_dir()
    adir = Path(args.artifact_dir) if args.artifact_dir else artifact_dir()
    adir.mkdir(parents=True, exist_ok=True)

    candles = load_candles(hdir, cfg.series, cfg.max_candles)
    samples, market_splits = build_samples(candles, cfg)
    split = limit_split_samples(split_samples(samples, market_splits), cfg.max_samples)
    norm = normalization(split["train"])
    tensors = {name: tensorize(rows, norm) for name, rows in split.items()}
    model = MarketTransformer(len(FEATURE_NAMES), cfg)

    pretrain_losses = train_pretrain(model, tensors["train"][0], tensors["train"][1], cfg)
    run_id = model_id()
    metadata = {
        "modelId": run_id,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "seriesTicker": cfg.series,
        "stage": "pretrained",
    }
    torch.save(checkpoint_payload(model, cfg, norm, metadata), adir / "pretrain-checkpoint.pt")

    rl_losses = train_policy(model, tensors["train"][0], tensors["train"][2], cfg)
    metrics = {name: evaluate_policy(model, xs, rewards) for name, (xs, _returns, rewards) in tensors.items()}
    candidate_meta = {
        **metadata,
        "stage": "rl-candidate",
        "metrics": metrics,
        "pretrainLossLast": pretrain_losses[-1] if pretrain_losses else None,
        "rlLossLast": rl_losses[-1] if rl_losses else None,
    }
    torch.save(checkpoint_payload(model, cfg, norm, candidate_meta), adir / "rl-candidate.pt")

    previous = read_json(adir / "last-run.json", {})
    previous_champion_metrics = read_json(adir / "champion-metadata.json", {}).get("metrics")
    candidate_score = metrics["validation"]["avgReward"] if metrics["validation"]["samples"] else metrics["train"]["avgReward"]
    incumbent_score = (
        previous_champion_metrics.get("validation", {}).get("avgReward")
        if isinstance(previous_champion_metrics, dict)
        else None
    )
    promoted = incumbent_score is None or candidate_score > float(incumbent_score)
    if promoted:
        torch.save(checkpoint_payload(model, cfg, norm, {**candidate_meta, "stage": "champion"}), adir / "champion.pt")
        write_json(adir / "champion-metadata.json", {**candidate_meta, "promotedAt": candidate_meta["generatedAt"]})

    run = {
        "runId": run_id,
        "generatedAt": candidate_meta["generatedAt"],
        "seriesTicker": cfg.series,
        "device": "cpu",
        "enabled": os.environ.get("KALSHI_PRETRAINED_RL_ENABLED", "false").lower() in {"1", "true", "yes", "on"},
        "artifactDir": str(adir),
        "historyDir": str(hdir),
        "candles": len(candles),
        "samples": {name: len(rows) for name, rows in split.items()},
        "markets": {name: len(markets) for name, markets in market_splits.items()},
        "featureNames": FEATURE_NAMES,
        "actionNames": ACTION_NAMES,
        "model": {
            "dModel": cfg.d_model,
            "heads": cfg.heads,
            "layers": cfg.layers,
            "sequenceMinutes": cfg.sequence_minutes,
        },
        "metrics": metrics,
        "promoted": promoted,
        "previousRunId": previous.get("runId"),
        "notes": [
            "Paper-shadow pretrained RL; no Kalshi orders are created.",
            "Artifacts are isolated under kalshi-pretrained-rl and do not touch genetic RL state.",
            "V1 success is end-to-end infrastructure, not immediate profitability.",
        ],
    }
    write_json(adir / "dataset-summary.json", {k: run[k] for k in ["generatedAt", "seriesTicker", "candles", "samples", "markets", "featureNames"]})
    history = read_json(adir / "run-history.json", [])
    write_json(adir / "run-history.json", [run] + [row for row in history if row.get("runId") != run_id][:49])
    write_json(adir / "last-run.json", run)
    signal = run_infer(argparse.Namespace(history_dir=str(hdir), artifact_dir=str(adir), checkpoint=None, quiet=True))
    run["latestSignal"] = signal
    write_json(adir / "last-run.json", run)
    return run


def latest_sample(samples: list[SequenceSample]) -> SequenceSample | None:
    return max(samples, key=lambda sample: (sample.end_ts, sample.market), default=None)


def predict_signal(
    model: MarketTransformer,
    cfg: Config,
    norm: dict[str, list[float]],
    metadata: dict[str, Any],
    sample: InferenceSample,
    lineage: str = "pretrained",
) -> dict[str, Any]:
    mean = np.asarray(norm["mean"], dtype=np.float32)
    std = np.asarray(norm["std"], dtype=np.float32)
    x = torch.from_numpy(((sample.x - mean) / std)[None, :, :].astype(np.float32))
    with torch.no_grad():
        out = model(x)
        probs = torch.softmax(out["logits"], dim=1)[0].cpu().numpy()
    action_index = int(np.argmax(probs))
    input_hash = hashlib.sha256(sample.x.astype(np.float32).tobytes()).hexdigest()[:16]
    action = ACTION_NAMES[action_index]
    side = "yes" if action.startswith("yes") else "no" if action.startswith("no") else "flat"
    size = "full" if action.endswith("full") else "small" if action.endswith("small") else "none"
    return {
        "ok": True,
        "modelId": metadata.get("modelId", MODEL_PREFIX),
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "seriesTicker": cfg.series,
        "marketTicker": sample.market,
        "observedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(sample.end_ts)),
        "mode": "paper-shadow",
        "lineage": lineage,
        "action": action,
        "side": side,
        "size": size,
        "confidence": float(probs[action_index]),
        "logits": {name: float(prob) for name, prob in zip(ACTION_NAMES, probs)},
        "inputWindowHash": input_hash,
        "entryMark": sample.entry_mark,
    }


def run_infer(args: argparse.Namespace) -> dict[str, Any]:
    adir = Path(args.artifact_dir) if args.artifact_dir else artifact_dir()
    hdir = Path(args.history_dir) if args.history_dir else history_dir()
    checkpoint = Path(args.checkpoint) if args.checkpoint else adir / "champion.pt"
    if not checkpoint.exists():
        checkpoint = adir / "rl-candidate.pt"
    if not checkpoint.exists():
        signal = {
            "ok": False,
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "reason": "No pretrained RL checkpoint exists yet.",
        }
        write_json(adir / "latest-shadow-signal.json", signal)
        return signal
    model, cfg, norm, metadata = load_checkpoint(checkpoint)
    candles = load_candles(hdir, cfg.series, cfg.max_candles)
    sample = inference_sample_from_candles(candles, cfg)
    if sample is None:
        signal = {
            "ok": False,
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "reason": "No complete candle sequence is available for inference.",
        }
        write_json(adir / "latest-shadow-signal.json", signal)
        return signal
    signal = predict_signal(model, cfg, norm, metadata, sample)
    write_json(adir / "latest-shadow-signal.json", signal)
    return signal


def run_infer_json(args: argparse.Namespace) -> dict[str, Any]:
    adir = Path(args.artifact_dir) if args.artifact_dir else artifact_dir()
    checkpoint = Path(args.checkpoint) if args.checkpoint else adir / "champion.pt"
    if not checkpoint.exists():
        checkpoint = adir / "rl-candidate.pt"
    if not checkpoint.exists():
        signal = {
            "ok": False,
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "reason": "No pretrained RL checkpoint exists yet.",
        }
        write_json(adir / "molly-live-signal.json", signal)
        return signal
    model, cfg, norm, metadata = load_checkpoint(checkpoint)
    raw = json.loads(Path(args.input_json).read_text(encoding="utf8"))
    events = raw if isinstance(raw, list) else raw.get("events", [])
    candles = [c for event in events if isinstance(event, dict) for c in [event_to_candle(event)] if c is not None]
    sample = inference_sample_from_candles(candles, cfg)
    if sample is None:
        signal = {
            "ok": False,
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "lineage": args.lineage,
            "reason": "No complete live sequence is available for inference.",
        }
        write_json(adir / "molly-live-signal.json", signal)
        return signal
    signal = predict_signal(model, cfg, norm, metadata, sample, args.lineage)
    write_json(adir / "molly-live-signal.json", signal)
    return signal


def run_summary(args: argparse.Namespace) -> dict[str, Any]:
    adir = Path(args.artifact_dir) if args.artifact_dir else artifact_dir()
    last = read_json(adir / "last-run.json", None)
    champion = read_json(adir / "champion-metadata.json", None)
    signal = read_json(adir / "latest-shadow-signal.json", None)
    history = read_json(adir / "run-history.json", [])
    return {
        "enabled": os.environ.get("KALSHI_PRETRAINED_RL_ENABLED", "false").lower() in {"1", "true", "yes", "on"},
        "seriesTicker": os.environ.get("KALSHI_PRETRAINED_RL_SERIES", "KXBTC15M"),
        "artifactDir": str(adir),
        "lastRun": last,
        "champion": champion,
        "latestSignal": signal,
        "runHistory": history[:20] if isinstance(history, list) else [],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="CPU-first Kalshi pretrained RL sidecar")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ["train", "infer", "infer-json", "summary"]:
        cmd = sub.add_parser(name)
        cmd.add_argument("--history-dir")
        cmd.add_argument("--artifact-dir")
    sub.choices["train"].add_argument("--max-samples", type=int, default=0)
    sub.choices["infer"].add_argument("--checkpoint")
    sub.choices["infer"].add_argument("--quiet", action="store_true")
    sub.choices["infer-json"].add_argument("--checkpoint")
    sub.choices["infer-json"].add_argument("--input-json", required=True)
    sub.choices["infer-json"].add_argument("--lineage", default="molly")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    if args.command == "train":
        result = run_train(args)
    elif args.command == "infer":
        result = run_infer(args)
    elif args.command == "infer-json":
        result = run_infer_json(args)
    else:
        result = run_summary(args)
    print(json.dumps(result, indent=2, sort_keys=True))
