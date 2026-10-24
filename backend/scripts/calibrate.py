"""Compare model levels against PSOC ratings and report agreement.

Usage: python scripts/calibrate.py data/psoc_ratings.csv
CSV columns: trail_id,rater,level  (level 1-5)
"""
import csv
import statistics
import sys
from collections import defaultdict

sys.path.insert(0, ".")
from app import store  # noqa: E402

path = sys.argv[1]
ratings = defaultdict(list)
with open(path) as f:
    for row in csv.DictReader(f):
        ratings[row["trail_id"]].append(int(row["level"]))

exact = within1 = n = 0
print(f"{'trail':40} model  psoc  diff")
for tid, levels in ratings.items():
    t = store.get(tid)
    if not t:
        print(f"{tid:40} (not in trails.json)")
        continue
    human = statistics.median(levels)
    diff = t.difficulty.level - human
    n += 1
    exact += diff == 0
    within1 += abs(diff) <= 1
    print(f"{t.name[:40]:40} {t.difficulty.level:5}  {human:4}  {diff:+.0f}")
if n:
    print(f"\nexact: {exact/n:.0%}   within ±1: {within1/n:.0%}   (n={n})")
