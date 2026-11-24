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


def evaluate(panel: pd.DataFrame, target: pd.Period, lag: int, floor: int = 0) -> pd.DataFrame:
    predictions = forecast(panel, target, lag).sort_index()
    predictions = predictions.loc[predictions.year_ago.ge(floor)]
    actual = panel.loc[target].reindex(predictions.index)
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


def run(data: Path, geography: Path, destination: Path) -> None:
    panel = load_panel(data)
    destination.mkdir(parents=True, exist_ok=True)
    monthly = pd.concat(
        [evaluate(panel, target, lag) for lag in (1, 0) for target in TARGETS],
        ignore_index=True,
    )
    monthly.to_csv(destination / "backtest.csv", index=False, float_format="%.8f")
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
    selection = history.groupby("method", sort=False).agg(
        mae=("mae", "mean"), top3_pct_mean=("top3_pct_mean", "mean"),
        top3_months=("top3_pct_mean", "count"),
        top3_hits=("top3_hits", "mean"),
    )
    selection.to_csv(destination / "selection.csv", float_format="%.8f")
    comparable = selection.loc[selection.top3_months.eq(history.target.nunique())]
    rank_method = comparable.loc[comparable.index.isin(METHODS), "top3_pct_mean"].idxmax()
    value_method = selection.mae.idxmin()
    predictions = forecast(panel, DEMO_TARGET, 1)
    selected = shortlist(predictions, rank_method)
    geography_rows = pd.read_csv(geography, dtype={"territory_id": str})
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
