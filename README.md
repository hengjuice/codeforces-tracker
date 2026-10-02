# Codeforces Tracker

Zero-dependency Node script that pulls your public Codeforces data and generates a self-contained dashboard (`report.html`).

## Usage

```bash
node track.js <handle> [--goal N] [--target R] [--serve [port]] [--open]
```

The handle, weekly goal and target rating are remembered in `config.json`, so afterwards just run `node track.js --open`. Requires Node 18+.

## What you get

- Solved count, streaks, weekly goal, activity heatmap, rating history
- **Road to Red**: rank ladder, per-band problem quotas, pace estimate (`--target 2400` = red)
- **Skill tree**: 28 tags x 5 rating tiers that unlock as you fill them
- Recommended problems, tag coverage, verdict/language stats, upcoming contests, contests entered

Quotas are heuristics; tune `quotas` and `tagQuota` in `config.json`.
Charts load Chart.js from a CDN, so viewing them needs internet access.

## Competitive Programming 4 integration

The **CP4 Books** tab maps the Codeforces tags in the skill tree to sections of *Competitive Programming 4* (Halim, Halim, Effendy), so you can read a topic and then practice it.

- Set the PDF locations under `books` in `config.json` (defaults to `D:Books...`). The PDFs are never copied or committed.
- `node track.js --serve --open` serves the dashboard at http://localhost:8787 and streams the PDFs, so section links open the book at the right page and ticking sections as read is saved to `config.json`.
- Without `--serve`, `report.html` still works: links open the local PDF files and read state is kept in the browser.
- `cp4.json` contains only the chapter/section titles and page numbers (the table of contents) plus the tag-to-section map. Edit it if you want different mappings.
