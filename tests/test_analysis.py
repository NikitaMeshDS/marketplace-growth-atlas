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
