"""Retrospective monthly forecasts and territory shortlists."""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd


METHODS = ("last", "seasonal", "market", "recent", "adaptive")
TARGETS = pd.period_range("2024-05", "2024-12", freq="M")
DEMO_TARGET = pd.Period("2024-12", freq="M")
FLOORS = (0, 1000, 2000, 3000)
REGIONAL_FLOOR = 2000
MIN_REGIONAL_CANDIDATES = 10
REGIONAL_RULES = {
    "last": "signal_hits",
    "last_delta": "absolute_delta_hits",
    "low_base": "low_base_hits",
    "recent": "recent_growth_hits",
    "adaptive": "adaptive_growth_hits",
}


def load_panel(path: Path) -> pd.DataFrame:
    rows = pd.read_parquet(path, columns=["territory_id", "date", "category", "value"])
    rows = rows.loc[rows.category.eq("Маркетплейсы")].copy()
    if rows.empty:
        raise ValueError("Категория «Маркетплейсы» отсутствует")
    rows["territory_id"] = rows.territory_id.astype(str)
    rows["month"] = pd.to_datetime(rows.date).dt.to_period("M")
    panel = rows.pivot(index="month", columns="territory_id", values="value").sort_index()
    return panel.where(np.isfinite(panel) & panel.gt(0))


def forecast(panel: pd.DataFrame, target: pd.Period, lag: int) -> pd.DataFrame:
    """A lag of 1 leaves the month immediately before target unobserved."""
    if lag not in (0, 1):
        raise ValueError("Лаг публикации должен быть 0 или 1 месяц")
    cutoff = target - 1 - lag
    historical = panel.loc[:cutoff]
    needed = pd.period_range(cutoff - 14, cutoff, freq="M")
    eligible = historical.reindex(needed).dropna(axis=1)
    if eligible.empty:
        raise ValueError(f"{target}: нет территорий с полными 15 месяцами до {cutoff}")
    recent = pd.period_range(cutoff - 2, cutoff, freq="M")
    year_ago = eligible.loc[target - 12]
    local_growth = (
        eligible.loc[recent].to_numpy() / eligible.loc[recent - 12].to_numpy()
    )
    local_growth = pd.Series(np.median(local_growth, axis=0), index=eligible.columns)
    market_growth = float(local_growth.median())
    return pd.DataFrame(
        {
            "year_ago": year_ago,
            "last": eligible.loc[cutoff],
            "seasonal": year_ago,
            "market": year_ago * market_growth,
            "recent": year_ago * (eligible.loc[cutoff] / eligible.loc[cutoff - 12]),
            "adaptive": year_ago * (local_growth + market_growth) / 2,
        }
    )


def shortlist(predictions: pd.DataFrame, method: str, count: int = 3) -> pd.DataFrame:
    """Rank by expected annual growth and resolve ties by territory ID."""
    growth = (predictions[method] - predictions.year_ago) / predictions.year_ago
    return predictions.assign(score=growth.round(12)).sort_index().sort_values(
        "score", ascending=False, kind="stable"
    ).head(count)


def prepare_pilot(
    predictions: pd.DataFrame,
    method: str,
    floor: int = 0,
    allowed_ids: set[str] | None = None,
    count: int = 3,
) -> pd.DataFrame:
    """Exclude ineligible locations before applying the historical ranking rule."""
    eligible = predictions.loc[predictions.year_ago.ge(floor)]
    if allowed_ids is not None:
        eligible = eligible.loc[eligible.index.isin(allowed_ids)]
    return shortlist(eligible, method, count=count)


def evaluate(
    panel: pd.DataFrame, target: pd.Period, lag: int, floor: int = 0,
    allowed_ids: set[str] | None = None,
) -> pd.DataFrame:
    predictions = forecast(panel, target, lag).sort_index()
    predictions = predictions.loc[predictions.year_ago.ge(floor)]
    if allowed_ids is not None:
        predictions = predictions.loc[predictions.index.isin(allowed_ids)]
    return evaluate_predictions(predictions, panel.loc[target], target, lag, floor)


def evaluate_predictions(
    predictions: pd.DataFrame, outcomes: pd.Series, target: pd.Period, lag: int, floor: int,
) -> pd.DataFrame:
    actual = outcomes.reindex(predictions.index)
    actual_growth = actual / predictions.year_ago - 1
    actual_percentile = actual_growth.rank(pct=True)
    rows = []
    observed_top3 = actual_growth.dropna().sort_values(ascending=False, kind="stable").head(3)
    ranking_baselines = {
        "low_base": -predictions.year_ago,
        "last_delta": predictions["last"] - predictions.year_ago,
    }
    for method in (*METHODS, *ranking_baselines):
        if method in ranking_baselines:
            predicted = pd.Series(np.nan, index=predictions.index)
            scores = ranking_baselines[method]
        else:
            predicted = predictions[method]
            scores = ((predicted - predictions.year_ago) / predictions.year_ago).round(12)
        selected = scores.sort_values(ascending=False, kind="stable").head(3)
        selected_pct = actual_percentile.reindex(selected.index)
        observed = actual.notna().sum()
        has_ranking = scores.nunique() > 1
        complete_top3 = has_ranking and len(selected) == 3 and selected_pct.notna().all()
        rank_correlation = (
            scores[actual.notna()].rank().corr(actual_growth.dropna().rank())
            if scores[actual.notna()].nunique() > 1 and actual_growth.nunique() > 1
            else np.nan
        )
        rows.append({
            "target": str(target),
            "lag": lag,
            "floor": floor,
            "method": method,
            "eligible": len(predictions),
            "pairs": int(observed),
            "mae": (predicted - actual).abs().mean(),
            "spearman_growth": rank_correlation,
            "top3_pct_mean": (
                selected_pct.mean() if complete_top3 else np.nan
            ),
            "top3_observed": int(selected_pct.notna().sum()) if has_ranking else 0,
            "top3_hits": len(selected.index.intersection(observed_top3.index)) if complete_top3 else np.nan,
        })
    return pd.DataFrame(rows)


def selection_history(monthly: pd.DataFrame, target: pd.Period, lag: int) -> pd.DataFrame:
    """Only score candidate methods with outcomes observable at the decision."""
    cutoff = target - 1 - lag
    return monthly.loc[monthly.lag.eq(lag) & monthly.target.le(str(cutoff))]


def select_methods(history: pd.DataFrame) -> tuple[pd.DataFrame, str, str]:
    scores = history.groupby("method", sort=False).agg(
        mae=("mae", "mean"), top3_pct_mean=("top3_pct_mean", "mean"),
        top3_months=("top3_pct_mean", "count"), top3_hits=("top3_hits", "mean"),
    )
    comparable = scores.loc[scores.top3_months.eq(history.target.nunique())]
    rank = comparable.loc[comparable.index.isin(METHODS), "top3_pct_mean"]
    return scores, rank.idxmax(), scores.mae.idxmin()


def walk_forward(monthly: pd.DataFrame, lag: int = 1, min_history: int = 3) -> pd.DataFrame:
    """Re-select both methods before scoring each future month."""
    results = []
    for month, entries in monthly.loc[monthly.lag.eq(lag)].groupby("target", sort=True):
        target = pd.Period(month, freq="M")
        history = selection_history(monthly, target, lag)
        months = history.target.nunique()
        if months < min_history:
            continue
        _, rank, value = select_methods(history)
        actual = entries.set_index("method")
        results.append({
            "target": month,
            "cutoff": str(target - 1 - lag),
            "history_months": months,
            "rank_method": rank,
            "rank_hits": actual.at[rank, "top3_hits"],
            "low_base_hits": actual.at["low_base", "top3_hits"],
            "value_method": value,
            "value_mae": actual.at[value, "mae"],
            "last_mae": actual.at["last", "mae"],
            "recent_mae": actual.at["recent", "mae"],
        })
    return pd.DataFrame(results)


def regional_backtest(panel: pd.DataFrame, geography: pd.DataFrame) -> pd.DataFrame:
    """Replay the public demo's Krasnoyarsk scenario on every archive month."""
    membership = geography.loc[
        geography.region_name.eq("Красноярский край") & geography.year.isin([2023, 2024])
    ]
    years = membership.groupby("territory_id").year.nunique()
    ids = set(years[years.eq(2)].index)
    result = []
    for target in TARGETS:
        scores = evaluate(panel, target, lag=1, floor=REGIONAL_FLOOR, allowed_ids=ids).set_index("method")
        last = scores.loc["last"]
        result.append({
            "target": str(target),
            "cutoff": str(target - 2),
            "eligible": int(last.eligible),
            "observed": int(last.pairs),
            "signal_hits": last.top3_hits,
            "absolute_delta_hits": scores.at["last_delta", "top3_hits"],
            "low_base_hits": scores.at["low_base", "top3_hits"],
        })
    return pd.DataFrame(result)


def regional_coverage(
    panel: pd.DataFrame, geography: pd.DataFrame, floor: int = REGIONAL_FLOOR,
) -> pd.DataFrame:
    """Compare fixed ranking rules with the same pool and fully known outcomes."""
    membership = geography.loc[geography.year.isin([2023, 2024])]
    years = membership.groupby(["region_name", "territory_id"]).year.nunique()
    stable = years[years.eq(2)].reset_index(name="years")
    regions = stable.groupby("region_name").territory_id.agg(set)
    result = []
    for target in TARGETS:
        predictions = forecast(panel, target, lag=1).sort_index()
        predictions = predictions.loc[predictions.year_ago.ge(floor)]
        outcomes = panel.loc[target]
        for region, ids in regions.items():
            pool = predictions.loc[predictions.index.isin(ids)]
            eligible = len(pool)
            observed = int(outcomes.reindex(pool.index).count())
            hits = dict.fromkeys(REGIONAL_RULES.values(), np.nan)
            if eligible < MIN_REGIONAL_CANDIDATES:
                status = "small_pool"
            elif observed < eligible:
                status = "missing_outcomes"
            else:
                scores = evaluate_predictions(pool, outcomes, target, 1, floor)
                measured_hits = scores.set_index("method").loc[list(REGIONAL_RULES), "top3_hits"]
                status = "unranked"
                if measured_hits.notna().all():
                    status = "compared"
                    hits = measured_hits.rename(index=REGIONAL_RULES).to_dict()
            result.append({
                "region": region, "target": str(target), "cutoff": str(target - 2),
                "floor": floor, "eligible": eligible, "observed": observed, "status": status, **hits,
            })
    return pd.DataFrame(result)


def summarize_regional_floors(results: pd.DataFrame) -> pd.DataFrame:
    """Report all scored slices and the region-months scored at every tested floor."""
    compared = results.loc[results.status.eq("compared")].copy()
    comparable_floors = compared.groupby(["region", "target"]).floor.transform("nunique")
    common = compared.loc[comparable_floors.eq(results.floor.nunique())]
    cohorts = pd.concat({"all": compared, "common": common}, names=["cohort"])
    by_floor = cohorts.groupby([cohorts.index.get_level_values("cohort"), "floor"])
    summary = by_floor[list(REGIONAL_RULES.values())].sum()
    summary.insert(0, "slices", by_floor.size())
    summary.insert(1, "slots", summary.slices * 3)
    return summary.reset_index()


def run(data: Path, geography: Path, destination: Path) -> None:
    panel = load_panel(data)
    destination.mkdir(parents=True, exist_ok=True)
    monthly = pd.concat(
        [evaluate(panel, target, lag) for lag in (1, 0) for target in TARGETS],
        ignore_index=True,
    )
    monthly.to_csv(destination / "backtest.csv", index=False, float_format="%.8f")
    walk_forward(monthly).to_csv(destination / "walk-forward.csv", index=False, float_format="%.8f")
    constrained = pd.concat(
        [evaluate(panel, target, 1, floor=floor) for floor in FLOORS for target in TARGETS],
        ignore_index=True,
    )
    constrained.to_csv(destination / "floor-backtest.csv", index=False, float_format="%.8f")
    ranking_comparison = constrained.pivot(
        index=["floor", "target"], columns="method", values="top3_hits"
    )[["last", "low_base", "last_delta"]].dropna()
    paired = ranking_comparison.groupby("floor").agg(
        months=("last", "count"), last_hits=("last", "sum"),
        low_base_hits=("low_base", "sum"), absolute_delta_hits=("last_delta", "sum"),
    )
    paired.insert(1, "slots", paired.months * 3)
    paired.to_csv(destination / "floor-comparison.csv", float_format="%.0f")
    summary = monthly.groupby(["lag", "method"], sort=False).agg(
        months=("target", "count"), pairs=("pairs", "sum"), mae=("mae", "mean"),
        spearman_growth=("spearman_growth", "mean"),
        top3_pct_mean=("top3_pct_mean", "mean"), top3_months=("top3_pct_mean", "count"),
        top3_hits=("top3_hits", "mean"),
    )
    summary.to_csv(destination / "summary.csv", float_format="%.8f")
    history = selection_history(monthly, DEMO_TARGET, 1)
    selection, rank_method, value_method = select_methods(history)
    selection.to_csv(destination / "selection.csv", float_format="%.8f")
    predictions = forecast(panel, DEMO_TARGET, 1)
    selected = shortlist(predictions, rank_method)
    geography_rows = pd.read_csv(geography, dtype={"territory_id": str})
    regional_backtest(panel, geography_rows).to_csv(
        destination / "krasnoyarsk-backtest.csv", index=False, float_format="%.0f"
    )
    regional_results = pd.concat(
        [regional_coverage(panel, geography_rows, floor) for floor in FLOORS], ignore_index=True,
    )
    regional_results.loc[regional_results.floor.eq(REGIONAL_FLOOR)].to_csv(
        destination / "regional-coverage.csv", index=False, float_format="%.0f"
    )
    summarize_regional_floors(regional_results).to_csv(
        destination / "regional-floor-comparison.csv", index=False, float_format="%.0f"
    )
    geo = geography_rows.loc[geography_rows.year.eq(DEMO_TARGET.year)].rename(columns={
        "municipal_district_name_short": "name",
        "municipal_district_center": "center",
        "municipal_district_center_lat": "lat",
        "municipal_district_center_lon": "lon",
    }).set_index("territory_id")
    if geo.index.has_duplicates:
        raise ValueError("Повторяющиеся идентификаторы в справочнике")
    result = selected.join(geo[["name", "region_name", "lat", "lon"]], how="left")
    if result[["name", "region_name", "lat", "lon"]].isna().any().any():
        raise ValueError("У выбранных территорий отсутствуют справочные данные")
    observed = panel.loc[DEMO_TARGET].reindex(predictions.index)
    result["actual"] = observed.reindex(result.index)
    result["actual_growth_rank"] = (observed / predictions.year_ago - 1).rank(
        ascending=False, method="min"
    ).reindex(result.index)
    result["actual_level_rank"] = observed.rank(ascending=False, method="min").reindex(result.index)
    result["actual_delta_rank"] = (observed - predictions.year_ago).rank(
        ascending=False, method="min"
    ).reindex(result.index)
    result["observed_count"] = observed.count()
    result["rank_signal"] = result[rank_method]
    result["value_forecast"] = result[value_method]
    result["rank_method"] = rank_method
    result["value_method"] = value_method
    result["target"] = str(DEMO_TARGET)
    result["cutoff"] = str(DEMO_TARGET - 2)
    result["candidate_count"] = len(predictions)
    result.to_csv(destination / "shortlist.csv", float_format="%.8f")
    pilot = prepare_pilot(predictions, rank_method, count=len(predictions)).join(
        geo[["name", "region_name", "center", "lat", "lon"]], how="left"
    )
    pilot["rank_signal"] = pilot[rank_method]
    pilot[["name", "region_name", "center", "lat", "lon", "year_ago", "rank_signal", "score"]].to_csv(
        destination / "pilot-candidates.csv", float_format="%.8f"
    )
    sensitivity = []
    for floor in FLOORS:
        eligible = predictions.loc[predictions.year_ago.ge(floor)]
        actual = panel.loc[DEMO_TARGET].reindex(eligible.index)
        pct = (actual / eligible.year_ago - 1).rank(pct=True)
        candidates = prepare_pilot(predictions, rank_method, floor=floor)
        for position, (territory_id, candidate) in enumerate(candidates.iterrows(), 1):
            sensitivity.append({
                "floor": floor, "position": position, "eligible": len(eligible),
                "territory_id": territory_id, "name": geo.name.get(territory_id),
                "year_ago": candidate.year_ago, "score": candidate.score,
                "actual_percentile": pct.get(territory_id),
            })
    pd.DataFrame(sensitivity).to_csv(destination / "floor-sensitivity.csv", index=False, float_format="%.8f")
    geo.reindex(predictions.index)[["lat", "lon"]].dropna().to_csv(
        destination / "map-points.csv", index=False, float_format="%.3f"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--geography", required=True, type=Path)
    parser.add_argument("--output", default=Path("evidence"), type=Path)
    args = parser.parse_args()
    run(args.data, args.geography, args.output)
