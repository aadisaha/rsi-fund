# Implementation Plan From `whitepaper.pdf`

## Scope

This plan translates the white paper's "differentiable corporation" / AlphaFund framework into an engineering roadmap. It is an implementation plan for research, measurement, simulation, and allocation infrastructure, not an investment recommendation.

## Extracted Key Content

### Core Thesis

The paper reframes recursive self-improvement as an economic control problem: a corporation recursively improves when realized economic gains finance the next cycle of better prediction and deployment. Quantitative trading is presented as the cleanest domain because actions, costs, outcomes, and reinvestment can be timestamped, priced, and audited.

The target object is an Autonomous Self-improving Corporation (ASIC): a firm whose capital allocation is increasingly executed by software, with every major expenditure scored by its expected contribution to future equity growth.

### Main Objects

1. **Shareholders' equity**
   - The scalar being compounded.
   - Defined as assets minus liabilities.
   - Per-period reward is log-return on equity.

2. **Corporation tuple**
   - `I`: Investments / trading book.
   - `S`: Sensors / data feeds and measurement.
   - `U`: Actuators / execution surface, venues, financing, instruments.
   - `Z`: R&D / research process, agents, experiments, tooling.
   - `Theta`: Parameters / learned model weights and forecasting structure.

3. **Action vector**
   - Dollar allocation into each channel:
     - `aI`: trading capital / rebalancing.
     - `aS`: data acquisition.
     - `aU`: execution or universe expansion.
     - `aZ`: research labor, agent runs, search infrastructure.
     - `aTheta`: training compute and model scale.

4. **Economic World Model (EWM)**
   - A filtration-respecting learned model of the next firm state, environment state, and reward.
   - Must only use information available at decision time.
   - Evaluated using held-out chronological proper scoring rules.
   - Ordinary LLMs are not EWMs unless wrapped in strict no-peeking evaluation and time-cutoff discipline.

5. **Portfolio optimizer**
   - A model-predictive controller that allocates deployable capital across heterogeneous channels.
   - Each channel is priced by marginal expected log-equity growth per dollar.
   - Risk-aware allocation uses posterior mean and covariance of channel returns.

6. **t-RSI**
   - A standardized signal-to-noise measure of net improvement:
     - alpha creation over a horizon minus alpha decay over that horizon,
     - divided by the standard error of the difference.
   - The paper reports a positive current t-RSI, with headline values appearing as 9.61 in the introduction and 9.39 in the figure text. This should be reconciled before implementation is treated as audit-ready.

### Empirical Channel Claims

1. **Investments**
   - Return is forecast edge minus execution friction.
   - Execution friction includes spread, impact, fees, financing, and adversarial response.
   - The paper emphasizes that friction cannot be fully learned from backtests and requires live execution data.

2. **Sensors**
   - Data spend is priced through a scaling law relating effective dollar-weighted tokens to predictive loss.
   - Reported fitted exponent: approximately `0.156`.
   - Interpretation: a 10x increase in effective data removes roughly 30% of reducible predictive error at the current operating point.

3. **Actuators**
   - Measured through tradable universe expansion.
   - Reported slopes:
     - Annualized return: about `8.417` percentage points per decade of effective data.
     - Sharpe: about `0.4696` per decade of effective data.

4. **R&D**
   - Measured through auto-research experiment frontiers.
   - Reported slopes:
     - Sharpe: about `0.3436` per decade of completed experiments.
     - Annualized return: about `2.135` percentage points per decade of completed experiments.
   - The paper flags this as a selection/frontier statistic, not yet a settled structural scaling law.

5. **Parameters**
   - Model-size / compute scaling is presented symbolically; the model-size sweep is still pending.
   - Alpha decay from stale parameters is measured as small or near zero in the reported panel.

6. **Continual learning**
   - The paper estimates a crossover where one-epoch loss equals best-epoch loss, implying the model can enter a prequential / walk-forward regime.
   - Reported intersection: about `3.204e14` dollar-weighted tokens, with a wide confidence interval.

7. **Capacity**
   - Current positive t-RSI is partly due to small AUM and sub-floor market impact.
   - Under worst-case frozen turnover, t-RSI turns negative before 100x AUM.
   - Under industry-norm turnover rolloff, t-RSI remains positive through 100x AUM in the paper's sensitivity table.

### Required Constraints

The controller must enforce:

- Budget: total allocation cannot exceed deployable capital.
- Channel liquidation floors: each channel can only free capital within realistic limits.
- Liquidity: cash must remain above an operational floor.
- Solvency: assets must remain greater than liabilities.
- Certificate gate: commits must clear readiness and held-out t-RSI thresholds.

### Completion Roadmap From Paper

The white paper explicitly identifies remaining gradients to instrument:

- Salary and headcount cost.
- Banking and cost of capital.
- Hardware procurement and depreciation.
- Asset acquisition cost.
- AUM acquisition cost.

## Implementation Roadmap

### Phase 0: Audit And Requirements Lock

Goal: make the paper's claims executable without silently importing inconsistencies.

Deliverables:

- Reconcile reported headline t-RSI values: `9.61`, `9.39`, and capacity-table variants.
- Define cycle length, decision cadence, horizon `H`, and horizon-to-cycle conversion.
- Define the exact unit of alpha: Sharpe units, log-equity units, or dollar PnL.
- Define what counts as deployable capital and reserves.
- Specify allowed asset universe, data feeds, brokerage interfaces, and execution constraints.
- Create a model governance document for filtration discipline.

Exit criteria:

- A single canonical formula sheet exists for each headline metric.
- Every metric has an owner, data source, timestamp convention, and no-peeking rule.

### Phase 1: Data And Ledger Foundation

Goal: build the append-only record the EWM, optimizer, and t-RSI calculation depend on.

Core tables:

- `observations`
  - `timestamp`, `source`, `asset_id`, `feature_name`, `value`, `available_at`, `ingested_at`.

- `actions`
  - `cycle_id`, `timestamp`, `channel`, `action_type`, `dollar_amount`, `metadata`, `approved_by`, `executed_at`.

- `positions`
  - `timestamp`, `asset_id`, `quantity`, `mark_price`, `market_value`, `cost_basis`, `broker`.

- `executions`
  - `timestamp`, `asset_id`, `side`, `quantity`, `price`, `fees`, `spread_estimate`, `slippage`, `venue`, `order_id`.

- `experiments`
  - `experiment_id`, `started_at`, `completed_at`, `researcher_or_agent`, `hypothesis`, `code_ref`, `train_window`, `validation_window`, `sealed_holdout_score`.

- `model_versions`
  - `model_id`, `trained_at`, `data_cutoff`, `parameter_count`, `training_cost`, `eval_scores`, `artifact_uri`.

- `balance_sheet_snapshots`
  - `cycle_id`, `equity`, `deployable_capital`, `cash`, `reserves`, `assets`, `liabilities`.

Engineering requirements:

- All rows must include `available_at` and `ingested_at`.
- All model training and evaluation jobs must declare data cutoffs.
- All derived features must be reproducible from rows available at decision time.
- Write once, append-only logs for production decisions and executions.

Exit criteria:

- A full trading/research cycle can be reconstructed from logs.
- A historical replay can prove that no post-decision information entered a forecast.

### Phase 2: Backtest And Forecast Evaluation Harness

Goal: create a strict chronological evaluation system before optimizing capital.

Components:

- Walk-forward splitter.
- Feature availability validator.
- Sealed holdout evaluator.
- Forecast scoring module:
  - negative log-likelihood for probabilistic forecasts,
  - CRPS or energy score for distributional forecasts,
  - point forecast diagnostics where needed.
- PnL simulator with explicit friction model.
- Report generator for per-asset, per-horizon, per-model performance.

Exit criteria:

- Every forecast is scored against outcomes unavailable at forecast time.
- The system can estimate alpha decay as a function of deployment age.
- Backtests show performance net of conservative friction assumptions.

### Phase 3: Economic World Model MVP

Goal: implement the first practical EWM as channel-specific models rather than a monolith.

Initial channel models:

- `EWM_I`: forecasts return distributions and execution friction for candidate trades.
- `EWM_S`: estimates loss reduction from added data.
- `EWM_U`: estimates performance gain from universe or execution-surface expansion.
- `EWM_Z`: estimates improvement frontier from completed research experiments.
- `EWM_Theta`: estimates parameter staleness and, later, model-size scaling.

Recommended MVP approach:

- Use simple, auditable statistical models first:
  - Bayesian regressions for scaling laws.
  - Bootstrap confidence intervals.
  - Per-asset decay estimators.
  - Gaussian posterior approximations for optimizer inputs.
- Store every fitted coefficient with data cutoffs and standard errors.

Exit criteria:

- Each active channel emits:
  - posterior mean marginal return,
  - uncertainty / SE,
  - data cutoff,
  - validation score,
  - readiness flag.

### Phase 4: Marginal Return Vector

Goal: convert channel models into a common dollar-denominated allocation input.

Implement:

- `gI`: forecast return minus execution friction as a function of trade size.
- `gS`: sensor dollars to effective data to predictive loss to expected return.
- `gU`: actuator dollars to universe/execution expansion to Sharpe or return lift.
- `gZ`: R&D dollars to experiments to frontier improvement.
- `gTheta`: training dollars to model scale / freshness to expected return.

Important normalization choices:

- Convert all channel outputs into the same target unit.
- Maintain both gross and net views:
  - gross alpha creation,
  - cost-adjusted equity impact,
  - risk-adjusted marginal return.
- Explicitly separate accounting cost from alpha-creation measurement where the paper does so.

Exit criteria:

- The system can produce a `g_t` vector for the current cycle.
- Each element has a traceable chain from source rows to fitted coefficient to final marginal return.

### Phase 5: Capital Allocation Optimizer

Goal: allocate deployable capital across channels subject to financial and operational constraints.

MVP optimizer:

- Mean-variance convex program:
  - maximize posterior mean marginal return minus risk penalty,
  - subject to deployable capital, liquidation floors, liquidity, and solvency constraints.

Inputs:

- `g_t`: posterior mean channel returns.
- `Sigma_t`: covariance matrix, diagonal at first.
- `K_deploy`: deployable capital.
- Channel floors and minimum ticket sizes.
- Risk aversion parameter.

Outputs:

- Proposed allocation by channel.
- Shadow price of capital.
- Binding constraints.
- Sensitivity to uncertainty and risk aversion.
- Human-readable audit report.

Exit criteria:

- Optimizer can run in dry-run mode on historical cycles.
- It can explain why each dollar is allocated or withheld.
- It refuses allocations that violate budget, liquidity, solvency, or certificate gates.

### Phase 6: t-RSI And Certificate Gate

Goal: implement the commit gate that prevents noisy self-promotion.

Implement:

- 90-day t-RSI calculation.
- End-to-end bootstrap of channel-row fits.
- Alpha creation posterior.
- Alpha decay posterior.
- Capacity-adjusted t-RSI sensitivity.
- Per-channel Fisher-information readiness thresholds.
- Certificate function:
  - active channels clear readiness floors,
  - held-out t-RSI clears margin threshold.

Exit criteria:

- Every candidate capital commit, model refit, data purchase, or research process change receives a certificate decision.
- Failed certificates produce actionable diagnostics.
- Certificate results are logged and later compared against realized outcomes.

### Phase 7: Production Trading Integration

Goal: connect the system to live trading with staged risk.

Stages:

1. Shadow mode:
   - generate allocations without executing.
   - compare proposed vs actual decisions.

2. Paper trading:
   - execute simulated orders with live data.
   - measure forecast, friction, and turnover assumptions.

3. Small-capital live pilot:
   - hard limits on notional, turnover, drawdown, and order participation.
   - mandatory human approval.

4. Controlled autonomy:
   - allow certified commits within bounded budgets.
   - human approval remains required for new channels, new venues, leverage, and model class changes.

Exit criteria:

- Live execution logs can update the friction surface.
- Realized PnL, slippage, impact, and forecast error are fed back into the EWM.
- Kill switches and rollback procedures are tested.

### Phase 8: Research Automation And Continual Learning

Goal: make R&D measurable and gradually shorten the model refresh loop.

Build:

- Experiment queue with sealed-holdout enforcement.
- Agent/human attribution of experiment cost and output.
- Frontier tracking:
  - running median,
  - top-k frontier,
  - deflated Sharpe adjustment,
  - multiple-testing controls.
- Model registry with refit cadence experiments.
- Continual-learning readiness monitor.

Exit criteria:

- R&D improvements are evaluated prospectively.
- The system can distinguish selection effects from structural improvement.
- Model refresh decisions are certificate-gated.

### Phase 9: Monolithic EWM And Differentiable Controller

Goal: replace hand-factored channel laws only after the channel-specific system is auditable.

Possible progression:

1. Joint EWM trained on operating history.
2. MPC rollout through the EWM.
3. Autodifferentiated allocation gradients.
4. Learned policy trained against cumulative log-equity objective.

Guardrails:

- Keep channel-specific models as interpretability baselines.
- Require the monolithic EWM to beat the factored system on sealed chronological evaluation.
- Preserve certificate gating for all deployed changes.

Exit criteria:

- Joint model improves forecast and allocation quality out of sample.
- Autodiff gradients match or improve realized marginal-return estimates.
- The system remains auditable under regime changes.

## Initial Technical Architecture

### Services

- `ledger-service`: append-only observations, actions, executions, positions, and balance sheet snapshots.
- `feature-service`: creates point-in-time feature views.
- `forecast-service`: trains and serves EWM forecasts.
- `research-service`: queues and evaluates experiments.
- `optimizer-service`: solves capital allocation.
- `certificate-service`: computes t-RSI and readiness gates.
- `execution-service`: routes approved trades and records fills.
- `reporting-service`: produces audit packs for each cycle.

### Storage

- Relational database for ledger, metadata, and audit records.
- Object storage for model artifacts, datasets, and backtest outputs.
- Time-series optimized store or partitioned tables for market data.
- Immutable artifact hashes for all training and evaluation runs.

### Interfaces

- CLI for local research and replay.
- Dashboard for current cycle state, proposed allocations, certificate status, and risk.
- API for optimizer and execution integration.
- Batch jobs for scaling-law refits and t-RSI recalculation.

## Suggested Build Order

1. Point-in-time ledger and replay.
2. Forecast evaluation harness.
3. Investment-channel backtest with friction accounting.
4. Alpha-decay estimator.
5. Sensor and actuator scaling-law notebooks/jobs.
6. R&D experiment tracker and sealed-holdout protocol.
7. Marginal-return vector generator.
8. Mean-variance optimizer.
9. t-RSI/certificate service.
10. Shadow-mode production loop.
11. Paper-trading loop.
12. Small-capital live pilot.

## Major Risks

- **No-peeking leakage**: the entire framework fails if model selection, features, or validation windows leak future information.
- **Backtest overfitting**: especially in R&D frontier claims.
- **Friction underestimation**: live trading costs can dominate apparent edge.
- **Capacity compression**: t-RSI may shrink quickly as AUM and order size grow.
- **Unit drift**: Sharpe, log-equity, dollar PnL, and alpha must not be mixed without explicit conversions.
- **Selection mistaken for scaling**: top-k research frontiers can rise even under stationary experiment distributions.
- **Operational autonomy risk**: capital allocation software must have kill switches, approvals, and hard risk limits.

## First 30-Day Plan

Week 1:

- Reconcile formulas and headline values.
- Define schema for ledger, actions, experiments, and model versions.
- Implement point-in-time data availability checks.

Week 2:

- Build walk-forward evaluation harness.
- Implement initial PnL simulator with conservative friction.
- Add alpha-decay estimator.

Week 3:

- Fit first sensor and actuator scaling-law jobs from available data.
- Implement R&D experiment registry and sealed-holdout checks.
- Generate first marginal-return vector prototype.

Week 4:

- Implement mean-variance optimizer in dry-run mode.
- Implement t-RSI bootstrap prototype.
- Produce first audit report for a historical cycle.

## Definition Of Done For MVP

The MVP is complete when a historical cycle can be replayed end to end:

1. The system reconstructs the decision-time filtration.
2. Channel models emit marginal returns and uncertainties.
3. The optimizer proposes an allocation.
4. The certificate service approves or rejects it.
5. The simulator executes the approved action.
6. Realized outcomes update the ledger.
7. The next cycle uses the new row without leakage.

