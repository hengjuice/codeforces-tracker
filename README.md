# Codeforces Tracker

Zero-dependency Node script that pulls your public Codeforces data and generates a self-contained dashboard (`report.html`).

## Usage

```bash
node track.js <handle> [--goal N] [--target R] [--open]
```

The handle, weekly goal and target rating are remembered in `config.json`, so afterwards just run `node track.js --open`. Requires Node 18+.

## What you get

- Solved count, streaks, weekly goal, activity heatmap, rating history
- **Road to Red**: rank ladder, per-band problem quotas, pace estimate (`--target 2400` = red)
- **Skill tree**: 28 tags x 5 rating tiers that unlock as you fill them
- Recommended problems, tag coverage, verdict/language stats, upcoming contests, contests entered

Quotas are heuristics; tune `quotas` and `tagQuota` in `config.json`.
Charts load Chart.js from a CDN, so viewing them needs internet access.
