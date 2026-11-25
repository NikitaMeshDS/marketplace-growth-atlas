import unittest
import pandas as pd
from analysis import forecast, evaluate, shortlist, prepare_pilot


def panel():
    return pd.DataFrame(
        {key: [100 + (offset + 2) * t for t in range(24)]
         for offset, key in enumerate(["A", "B", "C", "D", "E"])},
        index=pd.period_range("2023-01", periods=24, freq="M"),
    )


class AnalysisTests(unittest.TestCase):
    def test_delayed_and_future_values_cannot_change_forecast(self):
        original = panel()
        revised = original.copy()
        revised.loc["2024-07":] *= 20
        target = pd.Period("2024-08", freq="M")
        pd.testing.assert_frame_equal(forecast(original, target, 1), forecast(revised, target, 1))

    def test_missing_target_cannot_change_candidate_pool(self):
        original = panel()
        revised = original.copy()
        revised.loc["2024-08", "C"] = float("nan")
        target = pd.Period("2024-08", freq="M")
        self.assertIn("C", forecast(revised, target, 1).index)
        self.assertLess(evaluate(revised, target, 1).pairs.iloc[0], evaluate(original, target, 1).pairs.iloc[0])

    def test_baselines_use_last_observable_and_same_month_last_year(self):
        result = forecast(panel(), pd.Period("2024-08", freq="M"), 1)
        self.assertEqual(result.loc["A", "last"], 134)
        self.assertEqual(result.loc["A", "seasonal"], 114)

    def test_shortlist_is_deterministic_and_respects_limit(self):
        result = forecast(panel(), pd.Period("2024-08", freq="M"), 1)
        result["adaptive"] = result["year_ago"] * 1.25
        self.assertEqual(list(shortlist(result.sample(frac=1, random_state=5), "adaptive", 3).index), ["A", "B", "C"])

    def test_pilot_filters_before_ranking_and_keeps_smaller_lists(self):
        predictions = pd.DataFrame(
            {"year_ago": [10, 2000, 2500, 2400], "last": [300, 4000, 4500, 4900]},
            index=["A", "B", "C", "D"],
        )
        result = prepare_pilot(predictions, "last", floor=2000, allowed_ids={"A", "B", "C"})
        self.assertEqual(list(result.index), ["B", "C"])

    def test_floor_comparison_counts_the_eligible_pool_before_outcomes(self):
        original = panel()
        target = pd.Period("2024-08", freq="M")
        result = evaluate(original, target, 1, floor=130)
        self.assertEqual(result["eligible"].unique().tolist(), [2])
        self.assertTrue(result["top3_hits"].isna().all())

    def test_pilot_empty_filter_returns_no_candidates(self):
        predictions = forecast(panel(), pd.Period("2024-08", freq="M"), 1)
        self.assertTrue(prepare_pilot(predictions, "last", allowed_ids=set()).empty)

    def test_december_method_selection_uses_only_outcomes_available_by_october(self):
        from analysis import selection_history
        monthly = pd.DataFrame({
            "target": ["2024-10", "2024-11", "2024-11", "2024-12"],
            "lag": [1, 1, 0, 1],
        })
        target = pd.Period("2024-12", freq="M")
        self.assertEqual(selection_history(monthly, target, 1).target.tolist(), ["2024-10"])
        self.assertEqual(selection_history(monthly, target, 0).target.tolist(), ["2024-11"])

    def test_walk_forward_skips_short_history_and_never_uses_previous_month_with_lag(self):
        from analysis import walk_forward

        months = ["2024-05", "2024-06", "2024-07", "2024-08", "2024-09"]
        rows = []
        for index, month in enumerate(months):
            for method, early_pct, late_pct, early_mae, late_mae, hits in [
                ("last", .9, .1, 100, 600, 2),
                ("recent", .8, 1., 120, 10, 1),
                ("low_base", .95, .95, float("nan"), float("nan"), 3),
            ]:
                rows.append({
                    "target": month, "lag": 1, "method": method,
                    "mae": early_mae if index < 3 else late_mae, "pairs": 10,
                    "top3_pct_mean": early_pct if index < 3 else late_pct,
                    "top3_hits": hits,
                })
        result = walk_forward(pd.DataFrame(rows), min_history=3)
        self.assertEqual(result["target"].tolist(), ["2024-09"])
        september = result.iloc[0]
        self.assertEqual(september.cutoff, "2024-07")
        self.assertEqual(september.rank_method, "last")
        self.assertEqual(september.value_method, "last")
        self.assertEqual(september.value_mae, 600)
        self.assertEqual(september.low_base_hits, 3)

    def test_regional_evaluation_ranks_predictions_and_outcomes_inside_the_same_pool(self):
        data = panel()
        target = pd.Period("2024-08", freq="M")
        data.loc[target] = [200, 190, 160, 130, 20_000]
        data.loc[target - 2, "E"] = 10_000
        metrics = evaluate(data, target, 1, allowed_ids={"A", "B", "C", "D"}).set_index("method")
        self.assertEqual(metrics.at["last", "eligible"], 4)
        self.assertEqual(metrics.at["last", "pairs"], 4)
        self.assertEqual(metrics.at["last", "top3_hits"], 2)

    def test_regional_coverage_accounts_for_small_pools_and_missing_outcomes(self):
        from analysis import regional_coverage

        pools = {"complete": 10, "missing": 10, "small": 5}
        months = panel().index
        data = pd.DataFrame({
            f"{region}-{i}": [2400 + 20 * i + (i + 2) * t for t in range(len(months))]
            for region, count in pools.items() for i in range(count)
        }, index=months)
        data.loc["2024-08", "missing-2"] = float("nan")
        geography = pd.DataFrame([
            {"year": year, "region_name": key.split("-")[0], "territory_id": key}
            for key in data for year in (2023, 2024)
        ])
        moved = geography.territory_id.eq("small-0") & geography.year.eq(2023)
        geography.loc[moved, "region_name"] = "old"
        result = regional_coverage(data, geography)
        august = result.loc[result.target.eq("2024-08")].set_index("region")
        self.assertEqual(august.loc["complete", ["eligible", "observed", "status"]].tolist(), [10, 10, "compared"])
        self.assertEqual(august.loc["missing", ["eligible", "observed", "status"]].tolist(), [10, 9, "missing_outcomes"])
        self.assertEqual(august.loc["small", ["eligible", "observed", "status"]].tolist(), [4, 4, "small_pool"])
        self.assertTrue(pd.isna(august.at["missing", "signal_hits"]))
        self.assertTrue(pd.notna(august.at["complete", "signal_hits"]))
        self.assertEqual(august.at["complete", "recent_growth_hits"], 3)
        self.assertEqual(august.at["complete", "adaptive_growth_hits"], 3)

    def test_regional_threshold_summary_uses_the_same_region_months_across_thresholds(self):
        from analysis import summarize_regional_floors

        rows = []
        for floor, regions in ((0, ("A", "B")), (2000, ("B", "C"))):
            for region in regions:
                rows.append({
                    "floor": floor, "region": region, "target": "2024-08", "status": "compared",
                    "signal_hits": {"A": 3, "B": 2, "C": 0}[region], "absolute_delta_hits": 1,
                    "low_base_hits": 2, "recent_growth_hits": 2, "adaptive_growth_hits": 1,
                })
        summary = summarize_regional_floors(pd.DataFrame(rows)).set_index(["cohort", "floor"])
        self.assertEqual(summary.loc[("all", 0), ["slices", "slots", "signal_hits"]].tolist(), [2, 6, 5])
        self.assertEqual(summary.loc[("all", 2000), ["slices", "slots", "signal_hits"]].tolist(), [2, 6, 2])
        for floor in (0, 2000):
            self.assertEqual(summary.loc[("common", floor), ["slices", "slots", "signal_hits"]].tolist(), [1, 3, 2])
