#!/usr/bin/env node
// Codeforces progress tracker.
// Usage: node track.js [handle] [--goal N] [--target R] [--open]
// Handle and weekly goal are remembered in tracker/config.json after the first run.
// Fetches public API data and writes tracker/report.html (+ data.json).
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}

const args = process.argv.slice(2);
const goalIdx = args.indexOf('--goal');
const goalArg = goalIdx >= 0 ? Number(args[goalIdx + 1]) : NaN;
const targetIdx = args.indexOf('--target');
const targetArg = targetIdx >= 0 ? Number(args[targetIdx + 1]) : NaN;
const handle = args.find((a, i) => !a.startsWith('--') && i !== goalIdx + 1 && i !== targetIdx + 1) || process.env.CF_HANDLE || config.handle;
if (!handle) {
  console.error('Usage: node track.js <handle> [--goal N] [--target R] [--open]');
  process.exit(1);
}
const weeklyGoal = Number.isFinite(goalArg) && goalArg > 0 ? goalArg : config.weeklyGoal || 10;
const target = Number.isFinite(targetArg) && targetArg > 0 ? targetArg : config.target || 2400; // 2400 = red
// Problems to solve per problem-rating band on the way to the target. A rough heuristic; edit "quotas" in config.json to tune it.
const DEFAULT_QUOTAS = { 800: 30, 900: 30, 1000: 40, 1100: 40, 1200: 50, 1300: 50, 1400: 50, 1500: 50, 1600: 50, 1700: 50, 1800: 50, 1900: 40, 2000: 40, 2100: 40, 2200: 30, 2300: 30, 2400: 20 };
const quotas = config.quotas || DEFAULT_QUOTAS;
fs.writeFileSync(configPath, JSON.stringify({ handle, weeklyGoal, target, quotas, ...(config.tagQuota && { tagQuota: config.tagQuota }) }, null, 2) + '\n');

async function api(method, params = {}) {
  const url = `https://codeforces.com/api/${method}?` + new URLSearchParams(params);
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== 'OK') throw new Error(`${method}: ${json.comment}`);
  return json.result;
}

const DAY = 86400000;
const isoDay = t => new Date(t).toISOString().slice(0, 10);
const isGym = p => p.contestId >= 100000;
const keyOf = p => `${p.contestId ?? p.problemsetName}${p.index}`;
const brief = (p, extra = {}) => ({ key: keyOf(p), contestId: p.contestId, index: p.index, name: p.name, rating: p.rating || 0, tags: p.tags, ...extra });
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const count = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };

(async () => {
  const [[info], rating, subs, problemset, contests] = await Promise.all([
    api('user.info', { handles: handle }),
    api('user.rating', { handle }),
    api('user.status', { handle }),
    api('problemset.problems'),
    api('contest.list'),
  ]);

  // ---- Solves, attempts, verdicts, languages, participation (gym excluded) ----
  const chronological = subs.slice().reverse(); // user.status is newest-first
  const solved = new Map();
  const attempts = new Map(); // key -> { problem, wrong, last, solved }
  const verdicts = {}, languages = {}, byType = {}, contestSolves = {};
  let submissionsTotal = 0;

  for (const s of chronological) {
    const p = s.problem;
    if (isGym(p)) continue;
    submissionsTotal++;
    count(verdicts, s.verdict || 'TESTING');
    count(languages, s.programmingLanguage);
    const key = keyOf(p);
    const a = attempts.get(key) || { problem: p, wrong: 0, last: 0, solved: false };
    a.last = s.creationTimeSeconds;
    if (s.verdict === 'OK') {
      if (!a.solved) {
        a.solved = true;
        const type = s.author.participantType;
        solved.set(key, brief(p, { time: s.creationTimeSeconds, type, wrongBefore: a.wrong }));
        count(byType, type);
        if (type === 'CONTESTANT') count(contestSolves, s.contestId);
      }
    } else if (!a.solved) {
      a.wrong++;
    }
    attempts.set(key, a);
  }
  const solves = [...solved.values()].sort((a, b) => a.time - b.time);

  const byRating = {}, byTag = {}, byDay = {};
  for (const s of solves) {
    count(byRating, s.rating);
    for (const t of s.tags) count(byTag, t);
    count(byDay, isoDay(s.time * 1000));
  }

  // ---- Streaks (UTC days with at least one solve) ----
  let best = 0, run = 0, prev = null;
  for (const d of Object.keys(byDay).sort()) {
    const t = Date.parse(d);
    run = prev !== null && t - prev === DAY ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  const today = Date.parse(isoDay(Date.now()));
  let current = 0;
  for (let t = byDay[isoDay(today)] ? today : today - DAY; byDay[isoDay(t)]; t -= DAY) current++;

  // ---- Verdict stats ----
  const ok = verdicts.OK || 0;
  const wrongBefore = solves.map(s => s.wrongBefore);
  const stats = {
    submissions: submissionsTotal,
    accepted: ok,
    acceptRate: submissionsTotal ? ok / submissionsTotal : 0,
    avgWrongBeforeAccept: wrongBefore.length ? wrongBefore.reduce((a, b) => a + b, 0) / wrongBefore.length : 0,
    verdicts, languages,
  };
  const unsolved = [...attempts.values()]
    .filter(a => !a.solved)
    .sort((a, b) => b.last - a.last)
    .map(a => brief(a.problem, { time: a.last, tries: a.wrong }));

  // ---- Tag coverage + recommendations ----
  const catalog = problemset.problems.map((p, i) => ({ ...p, solvedCount: problemset.problemStatistics[i].solvedCount }));
  const tagTotals = {};
  for (const p of catalog) if (p.rating) for (const t of p.tags) count(tagTotals, t);
  const tagCoverage = Object.entries(tagTotals)
    .filter(([, total]) => total >= 100)
    .map(([tag, total]) => ({ tag, total, solved: solves.filter(s => s.rating && s.tags.includes(tag)).length }))
    .sort((a, b) => a.solved / a.total - b.solved / b.total);

  const rated = solves.filter(s => s.rating);
  const level = rated.length ? Math.round(median(rated.slice(-20).map(s => s.rating)) / 100) * 100 : 800;
  const unsolvedCatalog = catalog.filter(p => p.rating && !isGym(p) && !solved.has(keyOf(p)));
  const used = new Set();
  const weakTags = tagCoverage.filter(t => t.total >= 300).slice(0, 5);
  const recommendations = weakTags.map(t => {
    let picks = [];
    for (const width of [200, 300, 400]) {
      picks = unsolvedCatalog
        .filter(p => p.tags.includes(t.tag) && p.rating >= level && p.rating <= level + width && !used.has(keyOf(p)))
        .sort((a, b) => b.solvedCount - a.solvedCount)
        .slice(0, 3);
      if (picks.length >= 3) break;
    }
    picks.forEach(p => used.add(keyOf(p)));
    return { tag: t.tag, solved: t.solved, total: t.total, problems: picks.map(p => brief(p, { solvedCount: p.solvedCount })) };
  });

  // ---- Road to target: ladder of problems per rating band ----
  const bands = Object.entries(quotas)
    .map(([b, quota]) => ({ band: +b, quota, solved: byRating[b] || 0 }))
    .filter(b => b.band <= target)
    .sort((a, b) => a.band - b.band);
  const remaining = bands.reduce((n, b) => n + Math.max(0, b.quota - b.solved), 0);
  const quotaTotal = bands.reduce((n, b) => n + b.quota, 0);
  const done = bands.reduce((n, b) => n + Math.min(b.solved, b.quota), 0);
  const recent28 = solves.filter(s => s.time * 1000 >= Date.now() - 28 * DAY).length;
  const perWeek = recent28 / 4;
  const ladderNext = bands.filter(b => b.solved < b.quota).slice(0, 2).map(b => ({
    band: b.band, solved: b.solved, quota: b.quota,
    problems: unsolvedCatalog.filter(p => p.rating === b.band).sort((x, y) => y.solvedCount - x.solvedCount).slice(0, 5).map(p => brief(p, { solvedCount: p.solvedCount })),
  }));
  const road = {
    target, bands, remaining, quotaTotal, done, perWeek,
    etaWeeks: perWeek > 0 ? Math.ceil(remaining / perWeek) : null,
    ladderNext,
  };

  // ---- Tag skill tree: per tag, five rating tiers that unlock in order ----
  const TIERS = [[800, 1000], [1100, 1400], [1500, 1800], [1900, 2200], [2300, 3500]];
  const CATEGORIES = {
    Foundations: { quota: [8, 8, 6, 4, 3], tags: ['implementation', 'math', 'greedy', 'brute force', 'sortings', 'strings', 'constructive algorithms'] },
    Core: { quota: [6, 6, 6, 5, 4], tags: ['binary search', 'two pointers', 'dp', 'number theory', 'graphs', 'dfs and similar', 'data structures', 'bitmasks', 'dsu', 'trees', 'combinatorics'] },
    Advanced: { quota: [3, 4, 5, 5, 4], tags: ['shortest paths', 'divide and conquer', 'hashing', 'geometry', 'games', 'probabilities', 'flows', 'string suffix structures', 'fft', 'matrices'] },
  };
  const tagQuota = config.tagQuota || {};
  const UNLOCK = 0.6; // a tier unlocks once the previous one is 60% filled
  const skillTree = Object.entries(CATEGORIES).map(([category, { quota, tags }]) => ({
    category,
    tags: tags.map(tag => {
      const q = tagQuota[category] || quota;
      let prevOk = true;
      const tiers = TIERS.map(([lo, hi], i) => {
        const done = solves.filter(s => s.rating >= lo && s.rating <= hi && s.tags.includes(tag)).length;
        const status = done >= q[i] ? 'mastered' : prevOk ? 'active' : 'locked';
        prevOk = prevOk && done >= Math.ceil(q[i] * UNLOCK);
        const problems = status === 'active'
          ? unsolvedCatalog.filter(p => p.rating >= lo && p.rating <= hi && p.tags.includes(tag)).sort((a, b) => b.solvedCount - a.solvedCount).slice(0, 4).map(p => brief(p, { solvedCount: p.solvedCount }))
          : [];
        return { lo, hi: Math.min(hi, 2600), solved: done, quota: q[i], status, problems };
      });
      return { tag, tiers };
    }),
  }));
  const nodes = skillTree.flatMap(c => c.tags.flatMap(t => t.tiers.map((n, i) => ({ tag: t.tag, tier: i, ...n }))));
  const focus = nodes.filter(n => n.status === 'active')
    .sort((a, b) => a.tier - b.tier || a.solved / a.quota - b.solved / b.quota)
    .slice(0, 5).map(n => ({ tag: n.tag, tier: n.tier }));
  const tree = { tiers: TIERS.map(([lo, hi]) => `${lo}–${Math.min(hi, 2600)}`), skillTree, focus, mastered: nodes.filter(n => n.status === 'mastered').length, total: nodes.length };

  // ---- Upcoming contests ----
  const upcoming = contests
    .filter(c => c.phase === 'BEFORE')
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
    .slice(0, 6)
    .map(c => ({ id: c.id, name: c.name, start: c.startTimeSeconds, duration: c.durationSeconds }));

  // ---- Contest performance ----
  const contestName = Object.fromEntries(contests.map(c => [c.id, c.name]));
  const ratingByContest = Object.fromEntries(rating.map(r => [r.contestId, r]));
  const contestsEntered = Object.entries(contestSolves)
    .map(([id, n]) => ({ id: +id, name: contestName[id] || `Contest ${id}`, solved: n, rank: ratingByContest[id]?.rank ?? null, delta: ratingByContest[id] ? ratingByContest[id].newRating - ratingByContest[id].oldRating : null }))
    .sort((a, b) => b.id - a.id)
    .slice(0, 10);

  const data = {
    handle: info.handle, rating: info.rating || 0, maxRating: info.maxRating || 0, rank: info.rank || 'unrated',
    generated: new Date().toISOString(),
    totalSolved: solves.length, streak: { current, best },
    ratingHistory: rating.map(r => ({ t: r.ratingUpdateTimeSeconds, contest: r.contestName, rank: r.rank, old: r.oldRating, new: r.newRating })),
    byRating, byTag, byDay, byType, contestsEntered,
    goal: weeklyGoal, stats, unsolved: unsolved.slice(0, 15), unsolvedTotal: unsolved.length,
    road, tree, level, tagCoverage, recommendations, upcoming,
    recent: solves.slice(-15).reverse(),
  };

  fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify(data, null, 2));
  const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const out = path.join(__dirname, 'report.html');
  fs.writeFileSync(out, template.replace('/*DATA*/null', () => json));
  console.log(`${data.handle}: ${data.totalSolved} solved, rating ${data.rating} (max ${data.maxRating}), streak ${current}d (best ${best}d)`);
  console.log(`Wrote ${out}`);
  if (args.includes('--open')) require('child_process').exec(`start "" "${out}"`);
})().catch(e => { console.error(e.message); process.exit(1); });
