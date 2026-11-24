"""Build publication figures from saved evidence."""
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

EVIDENCE = Path("evidence")
INK = "#173641"
TEAL = "#007d78"
MUTED = "#536972"
BG = "#f2f6f4"
LABELS = {
    "last": "Последний уровень", "seasonal": "Год назад", "market": "Общий рост",
    "recent": "Последний годовой темп", "adaptive": "Сглаженный темп",
    "low_base": "Низкая база",
    "last_delta": "Прирост в рублях",
}


def format_ru(number, decimals=0):
    return f"{number:,.{decimals}f}".replace(",", " ").replace(".", ",")


def longitude(values):
    return np.mod(values, 360)


def map_figure(points, candidates):
    fig, ax = plt.subplots(figsize=(9.6, 3.45), layout="constrained", facecolor=BG)
    ax.set_facecolor(BG)
    ax.scatter(longitude(points.lon), points.lat, s=5, c="#a3b8b6", alpha=.82, linewidths=0)
    for pos, row in enumerate(candidates.itertuples(), 1):
        x = longitude(row.lon)
        ax.scatter(x, row.lat, s=230, c=TEAL, edgecolors="white", linewidths=1.5, zorder=3)
        ax.annotate(str(pos), (x, row.lat), va="center", ha="center",
                    color="white", fontsize=10, weight="bold", zorder=4)
    ax.set(xlim=(16, 198), ylim=(39, 77), xticks=np.arange(20, 200, 20), yticks=(40, 50, 60, 70))
    ax.set_xticklabels([f"{x}° в. д." if x <= 180 else f"{360-x}° з. д." for x in ax.get_xticks().astype(int)])
    ax.set_yticklabels([f"{y}° с. ш." for y in ax.get_yticks().astype(int)])
    ax.tick_params(length=0, colors=MUTED, labelsize=8, pad=8)
    ax.spines[:].set_visible(False)
    ax.set_axisbelow(True)
    ax.grid(color="#d5dfdc", linewidth=.7)
    fig.savefig(EVIDENCE / "shortlist-map.png", dpi=140)
    plt.close(fig)


def charts(monthly):
    sliced = monthly[monthly.lag.eq(1)]
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.6, 3.25), layout="constrained", facecolor="white")
    shades = dict(last=TEAL, recent="#c1573d", adaptive="#78919a", market="#694b91",
                  seasonal="#a4a9a7", low_base="#805927", last_delta="#616b80")
    for method, group in sliced.groupby("method", sort=False):
        if group.mae.notna().any():
            ax1.plot(range(len(group)), group.mae, marker="o", ms=3, color=shades[method], label=LABELS[method])
        if group.spearman_growth.notna().any():
            ax2.plot(range(len(group)), group.spearman_growth, marker="o", ms=3,
                     color=shades[method], label=LABELS[method])
    for ax, title in ((ax1, "Ошибка прогноза, ₽ на жителя"), (ax2, "Ранговая корреляция годового роста")):
        ax.axvspan(6.5, 7.3, color="#e8edeb", zorder=0)
        ax.set_title(title, loc="left", fontsize=10, weight="bold", color=INK)
        ax.set_xticks(range(8), ["май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"])
        ax.grid(axis="y", color="#e4ebeb", linewidth=.8)
        ax.tick_params(length=0, labelsize=8, colors=MUTED)
        ax.spines[:].set_visible(False)
    ax1.legend(frameon=False, fontsize=7, loc="upper left", ncol=2)
    ax2.legend(frameon=False, fontsize=7, loc="lower left", ncol=2)
    fig.savefig(EVIDENCE / "backtest.png", dpi=160)
    plt.close(fig)


if __name__ == "__main__":
    candidates = pd.read_csv(EVIDENCE / "shortlist.csv")
    points = pd.read_csv(EVIDENCE / "map-points.csv")
    monthly = pd.read_csv(EVIDENCE / "backtest.csv")
    map_figure(points, candidates)
    charts(monthly)
