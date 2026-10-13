// Study Planner scheduling engine.
// Pure, deterministic functions. No DOM, no storage, no network.
// Every allocation carries a `reasons` array explaining the rules that fired.

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEK_TYPES = ['teaching', 'break', 'swotvac', 'exam'];
export const ASSESSMENT_TYPES = ['exam', 'test', 'assignment', 'lab', 'quiz'];

// Tunable scoring constants (points added to a unit's weekly priority score).
export const WEIGHTS = {
  base: 1,            // every active unit starts here
  difficulty: 3,      // hardest unit gets the full 3, easiest gets 3/n
  confidence: 0.75,   // per point below 5/5
  weight: 2,          // per 100% of assessment weight still to come
  urgency: 6,         // per 100% of weight due, at the peak of the ramp
  hurdleMult: 1.5,    // hurdled exam counts 1.5x
  results: 5,         // per 100% below a 70% average mark (clamped)
  readiness: 0.5,     // per week rated "not yet" (shaky counts half), clamped
};
export const READINESS_RANGE = [-0.5, 2];
export const RESULTS_TARGET = 0.7;
export const RESULTS_RANGE = [-0.75, 1.5];
// Urgency ramp by weeks until due: due this week, 1, 2, 3 weeks away.
export const RAMP = [1, 0.8, 0.5, 0.25];
export const BASELINE_MAX = 2;      // hours per unit per teaching week
export const CAP_SHARE = 0.5;       // max share of a week for one unit
export const CATCHUP_SHARE = 0.5;   // max share of a week used for carried-forward work
export const SESSION_MAX = 2;       // default longest single study session (hours)
export const SESSION_CHOICES = [0.75, 1, 1.5, 2, 3];
export const REVIEW_GAPS = [1, 3, 7];
// Week readiness ratings: 1 = not yet, 2 = shaky, 3 = ready.
export const READINESS = { 1: 'not yet', 2: 'shaky', 3: 'ready' };
const REVIEW_WEIGHT = { 1: 2, 2: 1.5, 3: 0.5 };
const READINESS_ORDER = (v) => (v === 1 ? 0 : v === 2 ? 1 : v == null ? 2 : 3);
export const MAX_EXTRA_REVIEWS = 2;
export const DEFAULT_TENTATIVE_WEEK = 14;
export const PASS_MARK = 50;
export const DEFAULT_PREFS = { studyDays: [true, true, true, true, true, true, true], dailyMax: null, sessionLength: SESSION_MAX, checkin: true };

const EPS = 1e-9;
const floorHalf = (h) => Math.floor(h * 2 + EPS) / 2;
const floorQ = (h) => Math.floor(h * 4 + EPS) / 4;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fmtH = (h) => `${Math.round(h * 100) / 100}h`;
const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const weekList = (ws) => `Week${ws.length > 1 ? 's' : ''} ${listAnd([...ws].sort((a, b) => a - b).map(String))}`;
const listAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

// ---------- Dates & weeks ----------

export function parseISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export function toISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
export function addDays(iso, n) {
  return toISO(parseISO(iso) + n * 86400000);
}
export function mondayOf(iso) {
  const ms = parseISO(iso);
  const dow = (new Date(ms).getUTCDay() + 6) % 7; // 0 = Monday
  return toISO(ms - dow * 86400000);
}

/** Monash default: 12 teaching weeks, 1 SWOTVAC week, 3 exam weeks. */
export function defaultSemester(startDate) {
  return {
    startDate: mondayOf(startDate),
    weeks: [...Array(12).fill('teaching'), 'swotvac', 'exam', 'exam', 'exam'],
    tentativeWeek: DEFAULT_TENTATIVE_WEEK,
  };
}

export function buildWeeks(semester) {
  let t = 0, e = 0;
  return semester.weeks.map((type, i) => {
    const week = i + 1;
    let label;
    if (type === 'teaching') label = `Teaching week ${++t}`;
    else if (type === 'break') label = 'Mid-semester break';
    else if (type === 'swotvac') label = 'SWOTVAC';
    else label = `Exam week ${++e}`;
    return { week, type, label, teachingIndex: type === 'teaching' ? t : null, start: addDays(semester.startDate, i * 7) };
  });
}

/** Week number (1-based) that contains `todayISO`. Can be <1 or > length. */
export function weekForDate(semester, todayISO) {
  const diff = Math.round((parseISO(todayISO) - parseISO(semester.startDate)) / 86400000);
  return Math.floor(diff / 7) + 1;
}

export function hoursForWeek(state, week) {
  const o = state.hours?.overrides?.[week];
  const h = o != null && o !== '' ? Number(o) : Number(state.hours?.perWeek ?? 0);
  return Number.isFinite(h) && h > 0 ? h : 0;
}

/** The week that assessments with unknown dates are placed in, clamped to the semester. */
export function tentativeWeekOf(semester) {
  const n = semester.weeks?.length || 1;
  return clamp(Math.round(Number(semester.tentativeWeek) || DEFAULT_TENTATIVE_WEEK), 1, n);
}

/**
 * Resolve an assessment's due week and day (0 = Mon).
 * Week-only dues are assumed Friday. Unknown dates ("tbc") go in the tentative week.
 */
export function resolveDue(a, semester) {
  if (a.tbc) return { week: tentativeWeekOf(semester), day: 4, tentative: true };
  if (a.dueDate) {
    const diff = Math.round((parseISO(a.dueDate) - parseISO(semester.startDate)) / 86400000);
    return { week: Math.floor(diff / 7) + 1, day: ((diff % 7) + 7) % 7, tentative: false };
  }
  return { week: Number(a.dueWeek) || 1, day: 4, tentative: false };
}

export function isHurdled(a, unit) {
  return a.type === 'exam' && !!unit.exam?.hurdle;
}

/** Mark as a fraction 0..1, or null when no mark is recorded. */
export function markPct(a) {
  if (a.score == null || a.score === '' || !(Number(a.outOf) > 0)) return null;
  return clamp(Number(a.score) / Number(a.outOf), 0, 1);
}

/** Confidence in effect for a given week: the latest check-in at or before it, else the set-up value. */
export function confidenceFor(unit, week) {
  let c = Number(unit.confidence) || 3;
  const log = [...(unit.confidenceLog || [])].sort((a, b) => a.week - b.week);
  for (const e of log) if (e.week <= week) c = Number(e.value) || c;
  return clamp(Math.round(c), 1, 5);
}

/** Weighted average mark of assessments due before `week`, or null. */
export function resultsBefore(unit, semester, week) {
  const marked = (unit.assessments || [])
    .map((a) => ({ a, pct: markPct(a), due: resolveDue(a, semester) }))
    .filter((x) => x.pct != null && x.due.week < week);
  if (!marked.length) return null;
  const w = sum(marked, (x) => Number(x.a.weight) || 1);
  return { avg: sum(marked, (x) => x.pct * (Number(x.a.weight) || 1)) / w, count: marked.length };
}

/**
 * What the student needs on the remaining exam(s) to pass the unit.
 * Only available once every non-exam assessment has a mark.
 */
export function examOutlook(unit) {
  const all = unit.assessments || [];
  const exams = all.filter((a) => a.type === 'exam' && markPct(a) == null);
  const others = all.filter((a) => !exams.includes(a));
  if (!exams.length || others.some((a) => markPct(a) == null)) return null;
  const examW = sum(exams, (a) => Number(a.weight) || 0);
  if (!examW) return null;
  const totalW = sum(all, (a) => Number(a.weight) || 0);
  const earned = sum(others, (a) => markPct(a) * (Number(a.weight) || 0));
  const needOverall = ((PASS_MARK / 100) * totalW - earned) / examW * 100;
  const hurdle = Number(unit.exam?.hurdle) || 0;
  return { earned, examW, othersW: totalW - examW, needOverall, hurdle, need: Math.max(needOverall, hurdle) };
}

/**
 * Readiness (1-3) the student gave a week's content, as known when planning `planWeek`.
 * Ratings only count from the week they were made in, so earlier weeks of the plan don't change.
 */
export function readinessFor(unit, contentWeek, planWeek = Infinity) {
  const r = unit.readiness?.[contentWeek];
  if (r == null) return null;
  const v = Number(typeof r === 'object' ? r.v : r);
  const at = typeof r === 'object' && r.at != null ? Number(r.at) : -Infinity;
  return v >= 1 && v <= 3 && at <= planWeek ? v : null;
}

/** Teaching weeks before `planWeek` rated not yet / shaky, weakest (then most recent) first. */
export function weakWeeks(unit, weeks, planWeek) {
  return weeks
    .filter((wk) => wk.type === 'teaching' && wk.week < planWeek)
    .map((wk) => ({ wk, v: readinessFor(unit, wk.week, planWeek) }))
    .filter((x) => x.v === 1 || x.v === 2)
    .sort((a, b) => a.v - b.v || b.wk.week - a.wk.week);
}

/** Summary of ratings in effect for `planWeek` (content weeks before it). */
export function readinessSummary(unit, planWeek) {
  const rated = Object.keys(unit.readiness || {}).map(Number)
    .filter((k) => k < planWeek)
    .map((k) => ({ k, v: readinessFor(unit, k, planWeek) }))
    .filter((x) => x.v);
  return {
    notReady: rated.filter((x) => x.v === 1).map((x) => x.k),
    shaky: rated.filter((x) => x.v === 2).map((x) => x.k),
    ready: rated.filter((x) => x.v === 3).map((x) => x.k),
    count: rated.length,
  };
}

function rankText(rank, n) {
  if (n === 1) return 'your only unit';
  if (rank === 0) return 'ranked hardest';
  if (rank === n - 1) return 'ranked easiest';
  const ord = ['1st', '2nd', '3rd'][rank] || `${rank + 1}th`;
  return `ranked ${ord} hardest of ${n}`;
}

export function normalizePrefs(p = {}) {
  const days = Array.isArray(p.studyDays) && p.studyDays.length === 7 ? p.studyDays.map(Boolean) : DEFAULT_PREFS.studyDays;
  const dailyMax = Number(p.dailyMax) > 0 ? Number(p.dailyMax) : null;
  const sessionLength = Number(p.sessionLength) > 0 ? Number(p.sessionLength) : SESSION_MAX;
  return { studyDays: days.some(Boolean) ? days : DEFAULT_PREFS.studyDays, dailyMax, sessionLength, checkin: p.checkin !== false };
}

// ---------- Scoring ----------

/**
 * Priority score for one unit in one week.
 * Returns { score, breakdown, active, upcoming, dueThisWeek, remaining, conf, results }.
 */
export function scoreUnit(unit, rank, nUnits, weekInfo, semester) {
  const w = weekInfo.week;
  const all = (unit.assessments || []).map((a) => ({ ...a, due: resolveDue(a, semester) }));
  const remaining = all
    .filter((a) => !a.done && a.due.week >= w)
    .sort((a, b) => a.due.week - b.due.week || a.due.day - b.due.day);
  const studyWeek = weekInfo.type === 'teaching' || weekInfo.type === 'break';
  const active = studyWeek || remaining.length > 0;

  const conf = confidenceFor(unit, w);
  const results = resultsBefore(unit, semester, w);
  const readiness = readinessSummary(unit, w);
  const breakdown = {
    base: WEIGHTS.base,
    difficulty: WEIGHTS.difficulty * (nUnits - rank) / nUnits,
    confidence: WEIGHTS.confidence * (5 - conf),
    weight: 0,
    urgency: 0,
    hurdle: 0,
    results: results ? clamp((RESULTS_TARGET - results.avg) * WEIGHTS.results, ...RESULTS_RANGE) : 0,
    readiness: readiness.count
      ? clamp(WEIGHTS.readiness * (readiness.notReady.length + 0.5 * readiness.shaky.length) - 0.1 * readiness.ready.length, ...READINESS_RANGE)
      : 0,
  };
  const upcoming = [];
  for (const a of remaining) {
    const wt = (Number(a.weight) || 0) / 100;
    const k = a.due.week - w;
    const ramp = k < RAMP.length ? RAMP[k] : 0;
    const wTerm = WEIGHTS.weight * wt;
    const uTerm = WEIGHTS.urgency * wt * ramp;
    breakdown.weight += wTerm;
    breakdown.urgency += uTerm;
    if (isHurdled(a, unit)) breakdown.hurdle += (WEIGHTS.hurdleMult - 1) * (wTerm + uTerm);
    if (ramp > 0) upcoming.push({ ...a, weeksAway: k, ramp });
  }
  if (!active) for (const k of Object.keys(breakdown)) breakdown[k] = 0;
  for (const k of Object.keys(breakdown)) breakdown[k] = Math.round(breakdown[k] * 100) / 100;
  const score = Math.max(0, Math.round(sum(Object.values(breakdown)) * 100) / 100);
  const dueThisWeek = remaining.filter((a) => a.due.week === w);
  return { score, breakdown, active, upcoming, dueThisWeek, remaining, conf, results, readiness };
}

// ---------- Allocation for one week ----------

/**
 * Split `H` hours between scored units.
 * scored: [{ unit, rank, s (scoreUnit result) }] in rank order.
 * carryIn: { unitId: hours } unfinished work waiting to be placed.
 * Per-unit limits: unit.minHours / unit.maxHours (hours per week, optional).
 * Returns { allocations, carryOut, free }.
 */
export function allocateWeek(scored, H, weekInfo, carryIn = {}) {
  const teaching = weekInfo.type === 'teaching';
  const n = scored.length;
  const rows = scored.map(({ unit, rank, s }) => {
    const due = s.dueThisWeek.length > 0;
    let cap = due ? H : CAP_SHARE * H;
    let capKind = due && n > 1 ? 'lifted' : 'share';
    const min = clamp(Number(unit.minHours) || 0, 0, H);
    const max = unit.maxHours != null && unit.maxHours !== '' && Number(unit.maxHours) >= 0 ? Number(unit.maxHours) : Infinity;
    if (min > cap) { cap = min; capKind = 'min'; }
    if (max < cap) { cap = max; capKind = 'max'; }
    return { unit, rank, s, cap, capKind, min: Math.min(min, cap), max, catchUp: 0, baseline: 0, share: 0, hours: 0, capped: false };
  });
  const active = rows.filter((r) => r.s.active);
  const carryOut = {};

  // 1. Carried-forward work first, up to CATCHUP_SHARE of the week.
  let catchBudget = floorHalf(CATCHUP_SHARE * H);
  for (const r of rows) {
    const want = Number(carryIn[r.unit.id] || 0);
    if (want <= 0) continue;
    if (!r.s.active) { carryOut[r.unit.id] = (carryOut[r.unit.id] || 0) + want; continue; }
    const place = Math.min(floorQ(Math.min(want, r.cap)), catchBudget);
    r.catchUp = place;
    catchBudget -= place;
    if (want - place > EPS) carryOut[r.unit.id] = (carryOut[r.unit.id] || 0) + (want - place);
  }
  const F = H - sum(rows, (r) => r.catchUp);

  // 2. Baseline per unit in teaching weeks, raised to any minimum the student set.
  const b = teaching && active.length ? Math.min(BASELINE_MAX, floorHalf((F * 0.4) / active.length)) : 0;
  for (const r of active) {
    r.baseline = Math.max(0, Math.min(Math.max(b, r.min - r.catchUp), r.cap - r.catchUp));
    r.baseFromMin = r.min - r.catchUp > b + EPS;
  }
  const baseTotal = sum(active, (r) => r.baseline);
  if (baseTotal > F + EPS) for (const r of active) r.baseline = floorHalf((r.baseline * F) / baseTotal);

  // 3. Proportional split of the rest, with caps (water-filling).
  let pool = F - sum(active, (r) => r.baseline);
  let open = active.filter((r) => r.s.score > 0 && r.cap - r.catchUp - r.baseline > EPS);
  while (pool > EPS && open.length) {
    const total = sum(open, (r) => r.s.score);
    const over = open.filter((r) => r.share + (pool * r.s.score) / total > r.cap - r.catchUp - r.baseline + EPS);
    if (!over.length) {
      for (const r of open) r.share += (pool * r.s.score) / total;
      pool = 0;
      break;
    }
    for (const r of over) {
      const room = r.cap - r.catchUp - r.baseline - r.share;
      r.share += room;
      pool -= room;
      r.capped = true;
    }
    open = open.filter((r) => !over.includes(r));
  }

  // 4. Round to half hours without exceeding the week.
  for (const r of rows) {
    const raw = r.baseline + r.share;
    r.fresh = floorHalf(raw);
    r.frac = raw - r.fresh;
  }
  let left = floorHalf(F - sum(rows, (r) => r.fresh));
  const byFrac = [...active].sort((a, b) => b.frac - a.frac || a.rank - b.rank);
  for (const r of byFrac) {
    if (left < 0.5) break;
    if (r.frac > EPS && r.catchUp + r.fresh + 0.5 <= r.cap + EPS) { r.fresh += 0.5; left -= 0.5; }
  }
  for (const r of rows) r.hours = r.catchUp + r.fresh;
  const free = Math.max(0, Math.round((H - sum(rows, (r) => r.hours)) * 100) / 100);

  const allocations = rows.map((r) => ({
    unitId: r.unit.id,
    code: r.unit.code,
    hours: r.hours,
    fresh: r.fresh,
    catchUp: r.catchUp,
    score: r.s.score,
    breakdown: r.s.breakdown,
    reasons: explainAllocation(r, n, H, weekInfo),
  }));
  return { allocations, carryOut, free, rows };
}

function headlineFactors(r, n, weekInfo) {
  const parts = [rankText(r.rank, n), `confidence ${r.s.conf}/5`];
  const pick = weekInfo.type === 'teaching' || weekInfo.type === 'break'
    ? [...r.s.remaining].sort((a, b) => (b.weight || 0) - (a.weight || 0))[0]
    : r.s.remaining[0];
  if (pick) {
    const hurdle = isHurdled(pick, r.unit) ? ' with hurdle' : '';
    const tbc = pick.due.tentative ? ' (date TBC)' : '';
    parts.push(`${pick.weight}% ${pick.type}${hurdle} in Week ${pick.due.week}${tbc}`);
  }
  return parts;
}

function explainAllocation(r, n, H, weekInfo) {
  const code = r.unit.code;
  if (!r.s.active) return [`${code} gets 0h: all of its assessments are finished.`];
  if (H <= 0) return [`${code} gets 0h: no study hours are available this week.`];
  const reasons = [`${code} gets ${fmtH(r.hours)}: ${headlineFactors(r, n, weekInfo).join(', ')}.`];
  if (weekInfo.type === 'swotvac') reasons.push('SWOTVAC: time shifts to past papers and revision.');
  if (weekInfo.type === 'exam') {
    const next = r.s.remaining[0];
    reasons.push(next ? `Exam period: revision is ordered by exam date. Next: ${next.name} in Week ${next.due.week}.` : 'Exam period.');
  }
  if (weekInfo.type === 'break') reasons.push('Mid-semester break: no new lectures, so time goes to practice and review.');
  for (const a of r.s.upcoming) {
    if (a.weeksAway === 0) reasons.push(`${a.name} (${a.weight}%) is due this week, so it gets top priority.`);
    else reasons.push(`Ramping up for ${a.name} (${a.weight}%) in ${plural(a.weeksAway, 'week')}.`);
  }
  const tbc = r.s.remaining.filter((a) => a.due.tentative && a.due.week - weekInfo.week < RAMP.length);
  for (const a of tbc) reasons.push(`${a.name} date not announced yet: planned for Week ${a.due.week} for now.`);
  if (r.s.breakdown.hurdle > 0) reasons.push(`Hurdle: must score ${r.unit.exam.hurdle}% on the exam, so it counts ${WEIGHTS.hurdleMult}× when planning.`);
  const rd = r.s.readiness;
  if (rd && (rd.notReady.length || rd.shaky.length)) {
    const bits = [];
    if (rd.notReady.length) bits.push(`${weekList(rd.notReady)} not ready yet`);
    if (rd.shaky.length) bits.push(`${weekList(rd.shaky)} shaky`);
    const many = rd.notReady.length + rd.shaky.length > 1;
    reasons.push(`You rated ${bits.join(' and ')}, so ${many ? 'those weeks get' : 'that week gets'} extra review.`);
  }
  if (r.s.results) {
    const pct = Math.round(r.s.results.avg * 100);
    if (r.s.breakdown.results > 0) reasons.push(`Marks so far average ${pct}%, so it gets extra time.`);
    else if (r.s.breakdown.results < 0) reasons.push(`Marks so far average ${pct}%: going well, so a little less time.`);
  }
  if (r.baseline > 0 && r.baseFromMin) reasons.push(`You asked for at least ${fmtH(r.min)} a week.`);
  else if (r.baseline > 0) reasons.push(`Includes a ${fmtH(r.baseline)} baseline so lectures are not missed.`);
  if (r.min > 0 && r.hours + EPS < r.min) reasons.push(`You asked for at least ${fmtH(r.min)}, but only ${fmtH(r.hours)} fit this week.`);
  if (r.capped && r.capKind === 'max') reasons.push(`Capped at your limit of ${fmtH(r.max)} a week.`);
  else if (r.capped && r.capKind === 'share') reasons.push(`Capped at ${CAP_SHARE * 100}% of this week's ${fmtH(H)} so other units still get time.`);
  else if (r.capKind === 'lifted' && r.hours > CAP_SHARE * H) reasons.push(`The ${CAP_SHARE * 100}% cap is lifted because ${r.s.dueThisWeek[0].name} is due this week.`);
  if (r.catchUp > 0) reasons.push(`Includes ${fmtH(r.catchUp)} of unfinished work carried forward.`);
  if (r.hours === 0) reasons.push('Higher-priority work filled this week.');
  return reasons;
}

// ---------- Tasks ----------

/** Split `total` hours across weighted parts in 0.5h chunks; sum is exact for multiples of 0.5. */
function splitHalves(total, parts) {
  const halves = Math.round(total * 2);
  const wsum = sum(parts, (p) => p.w);
  if (!halves || !wsum) return parts.map((p) => ({ ...p, hours: 0 }));
  const raw = parts.map((p) => (halves * p.w) / wsum);
  const base = raw.map(Math.floor);
  let left = halves - sum(base);
  const order = raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; base[i]++; left--; }
  return parts.map((p, i) => ({ ...p, hours: base[i] / 2 }));
}

/** Split hours into sessions no longer than `len`, in quarter hours. Sum is exact. */
export function splitSessions(total, len) {
  const q = Math.round(total * 4);
  if (q <= 0) return [];
  const n = Math.max(1, Math.ceil(total / len - EPS));
  const base = Math.floor(q / n);
  const rem = q - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < rem ? 1 : 0)) / 4).filter((h) => h > 0);
}

const PRACTICE_TITLE = {
  calculations: 'Practice problems',
  mcq: 'MCQ drills',
  essays: 'Essay planning practice',
  mixed: 'Mixed practice questions',
};

const topicOf = (unit, week) => String(unit.topics?.[week] ?? '').trim();

/** Turn one unit's weekly allocation into task parts (before day assignment). Each part has a stable `key`. */
export function buildTaskParts(alloc, unit, s, weekInfo, weeks) {
  const w = weekInfo.week;
  const parts = [];
  const practiceTitle = PRACTICE_TITLE[unit.exam?.format] || 'Practice problems';
  if (alloc.catchUp > 0) {
    parts.push({ key: 'catchup', kind: 'catchup', title: 'Catch up on unfinished work', w: 0, hours: alloc.catchUp, reason: 'Carried forward from missed or unfinished tasks.' });
  }
  const h = alloc.fresh;
  if (h <= 0) return parts;

  if (weekInfo.type === 'swotvac' || weekInfo.type === 'exam') {
    const target = s.remaining[0];
    if (!target) return parts;
    const papers = unit.exam?.pastPapers !== false;
    const openBook = unit.exam?.book === 'open';
    const tbc = target.due.tentative ? ' Date not announced yet, so this is planned for now.' : '';
    const weak = weakWeeks(unit, weeks, w).slice(0, 2);
    const weakNames = listAnd(weak.map((x) => topicOf(unit, x.wk.week) || `Week ${x.wk.week}`));
    const revTitle = weak.length
      ? (openBook ? `Open-book notes on weak spots: ${weakNames}` : `Revise weak spots: ${weakNames}`)
      : (openBook ? `Build open-book notes for ${target.name}` : `Active-recall revision for ${target.name}`);
    const revReason = weak.length
      ? `You rated ${weekList(weak.map((x) => x.wk.week))} not ready or shaky, so revision for ${target.name} starts there.`
      : (openBook ? 'Open book: organise notes and a formula sheet you can find things in fast.' : 'Closed book: practise recalling key ideas from memory.');
    const split = splitHalves(h, [
      { key: `pp-${target.id}`, kind: 'pastpaper', w: 0.6, title: papers ? `Timed past paper for ${target.name}` : `Exam-style questions for ${target.name}`,
        reason: (papers ? `Past papers are the best prep for ${target.name} (Week ${target.due.week}).` : 'No past papers, so use exam-style practice questions instead.') + tbc },
      { key: `rev-${target.id}`, kind: 'revision', w: 0.4, title: revTitle, reason: revReason },
    ]);
    for (const p of split) parts.push({ ...p, assessmentId: target.id, due: target.due });
    return parts;
  }

  // Teaching / break weeks.
  const spec = [];
  const soon = s.remaining
    .filter((a) => a.due.week - w <= 2)
    .sort((a, b) => a.due.week - b.due.week || (b.weight || 0) - (a.weight || 0))[0];
  if (soon) {
    const k = soon.due.week - w;
    const frac = k === 0 ? 0.5 : k === 1 ? 0.4 : 0.25;
    const when = k === 0 ? `due ${DAY_NAMES[soon.due.day]} this week` : `due in ${plural(k, 'week')}`;
    let kind = 'assignment', title = `Work on ${soon.name}`;
    if (soon.type === 'test' || soon.type === 'quiz') { kind = 'practice'; title = `Prepare for ${soon.name}`; }
    if (soon.type === 'exam') { kind = 'pastpaper'; title = unit.exam?.pastPapers !== false ? `Past paper for ${soon.name}` : `Exam-style questions for ${soon.name}`; }
    const tbc = soon.due.tentative ? ' (date not announced yet, planned for now)' : '';
    spec.push({ key: `a-${soon.id}`, kind, w: frac, title, reason: `${soon.name} (${soon.weight}%) is ${when}${tbc}.`, assessmentId: soon.id, due: soon.due });
  }
  const rest = 1 - sum(spec, (p) => p.w);
  // Spaced reviews at 1, 3 and 7 weeks (weeks rated ready skip the later ones),
  // plus up to two extra weeks rated not yet / shaky. Weakest first so they survive when time is short.
  const base = REVIEW_GAPS
    .map((g) => ({ g, wk: weeks[w - 1 - g] }))
    .filter((x) => x.wk && x.wk.type === 'teaching')
    .map((x) => ({ ...x, v: readinessFor(unit, x.wk.week, w) }))
    .filter((x) => x.g === 1 || x.v !== 3);
  const extra = weakWeeks(unit, weeks, w)
    .filter((x) => !base.some((b) => b.wk.week === x.wk.week))
    .slice(0, MAX_EXTRA_REVIEWS)
    .map((x) => ({ g: w - x.wk.week, wk: x.wk, v: x.v }));
  const sources = [...base, ...extra].sort((a, b) => READINESS_ORDER(a.v) - READINESS_ORDER(b.v));
  const weakCount = sources.filter((x) => x.v === 1 || x.v === 2).length;
  const teaching = weekInfo.type === 'teaching';
  const learnW = teaching ? 0.45 : 0;
  const reviewW = !sources.length ? 0 : teaching ? Math.min(0.35, 0.2 + 0.05 * weakCount) : Math.min(0.6, 0.5 + 0.05 * weakCount);
  const practiceW = 1 - learnW - reviewW;
  if (learnW) {
    const topic = topicOf(unit, w);
    spec.push({ key: 'learn', kind: 'learn', w: rest * learnW, title: topic ? `Learn: ${topic}` : 'Learn new content: lectures and notes',
      reason: `Keep up with Teaching week ${weekInfo.teachingIndex} content.` });
  }
  spec.push({ key: 'practice', kind: 'practice', w: rest * practiceW, title: practiceTitle, reason: `Exam format is ${unit.exam?.format || 'calculations'}, so practise that style.` });
  // Spaced review: at least 0.5h per source when there is room, otherwise fewer sources.
  const halves = Math.round(h * 2);
  let reviewHalves = Math.round(halves * rest * reviewW);
  let usable = [];
  if (reviewW) {
    const fit = halves >= sources.length + 2 ? sources.length : Math.min(sources.length, reviewHalves);
    usable = sources.slice(0, fit);
    reviewHalves = usable.length ? Math.max(reviewHalves, usable.length) : 0;
  }
  for (const p of splitHalves((halves - reviewHalves) / 2, spec)) if (p.hours > 0) parts.push(p);
  const reviews = usable.map((src) => {
    const wkNo = src.wk.week;
    const topic = topicOf(unit, wkNo);
    const what = topic || `Week ${wkNo} topics`;
    const base = { key: `r${wkNo}`, kind: 'review', w: REVIEW_WEIGHT[src.v] ?? 1, reviewWeek: wkNo };
    if (src.v === 1) return { ...base, title: `Rework: ${what}`, reason: `You rated Week ${wkNo} not ready yet, so it gets extra review.` };
    if (src.v === 2) return { ...base, title: `Shore up: ${what}`, reason: `You rated Week ${wkNo} shaky, so it gets a little extra review.` };
    return { ...base,
      title: topic ? `Review: ${topic}` : `Spaced review: Week ${wkNo} topics`,
      reason: `${plural(src.g, 'week')} since you learnt it${topic ? ` in Week ${wkNo}` : ''}, the right time to revisit.${src.v === 3 ? ' You rated it ready, so a quick check is enough.' : ''}` };
  });
  for (const p of splitHalves(reviewHalves / 2, reviews)) if (p.hours > 0) parts.push(p);
  return parts;
}

/**
 * Break parts into sessions and place them on days. Deterministic.
 * ctx: { allowedDays, dailyMax, sessionLength, edits: { taskId: { day, hours } }, free }
 *  - Tasks the student moved stay on their chosen day; the rest are planned around them.
 *  - Work for an assessment never lands after its due day.
 *  - Edited hours can only grow into the week's free hours.
 */
export function scheduleDays(unitParts, weekInfo, ctx = {}) {
  const allowed = ctx.allowedDays?.length ? ctx.allowedDays : [0, 1, 2, 3, 4, 5, 6];
  const dailyMax = ctx.dailyMax || null;
  const sessionLen = ctx.sessionLength > 0 ? ctx.sessionLength : SESSION_MAX;
  const edits = ctx.edits || {};
  let budget = Math.max(0, ctx.free || 0);
  const sessions = [];
  for (const { unit, parts } of unitParts) {
    for (const p of parts) {
      if (p.hours <= 0) continue;
      splitSessions(p.hours, sessionLen).forEach((h, i) => {
        sessions.push({
          id: `w${weekInfo.week}-${unit.id}-${p.key}-${i}`,
          unitId: unit.id, code: unit.code, week: weekInfo.week, kind: p.kind, title: p.title,
          hours: h, plannedHours: h, assessmentId: p.assessmentId || null, reason: p.reason, reviewWeek: p.reviewWeek ?? null,
          latestDay: p.due && p.due.week === weekInfo.week ? p.due.day : 6,
          dueOrder: p.due ? p.due.week * 7 + p.due.day : Infinity,
        });
      });
    }
  }
  // Student edits, applied in a fixed order.
  for (const t of [...sessions].sort((a, b) => a.id.localeCompare(b.id))) {
    const e = edits[t.id];
    if (!e) continue;
    if (e.hours != null && e.hours !== '') {
      let h = Math.max(0.25, Math.round(Number(e.hours) * 4) / 4);
      if (h > t.hours) {
        const extra = floorQ(Math.min(h - t.hours, budget));
        h = t.hours + extra;
        budget -= extra;
      }
      if (h !== t.hours) { t.hours = h; t.edited = true; }
    }
    if (e.day != null && e.day !== '') {
      t.day = clamp(Math.round(Number(e.day)), 0, t.latestDay);
      t.pinned = true;
      t.edited = true;
    }
  }
  const load = Array(7).fill(0);
  for (const t of sessions) if (t.pinned) load[t.day] += t.hours;
  const loose = sessions.filter((t) => !t.pinned)
    .sort((a, b) => a.latestDay - b.latestDay || a.dueOrder - b.dueOrder || b.hours - a.hours || a.id.localeCompare(b.id));
  const queue = [...loose];
  while (queue.length) {
    const t = queue.shift();
    let cands = allowed.filter((d) => d <= t.latestDay);
    if (!cands.length) { cands = Array.from({ length: t.latestDay + 1 }, (_, d) => d); t.offDay = true; }
    const fits = dailyMax ? cands.filter((d) => load[d] + t.hours <= dailyMax + EPS) : cands;
    if (dailyMax && !fits.length && !t.offDay) {
      // No day has room for the whole session: fill the roomiest day and carry the rest to another day.
      const roomiest = cands.reduce((b, d) => (load[d] < load[b] - EPS ? d : b), cands[0]);
      const piece = floorQ(dailyMax - load[roomiest]);
      if (piece >= 0.25 && piece < t.hours) {
        const rest = { ...t, id: `${t.id}s`, hours: t.hours - piece, plannedHours: t.hours - piece };
        sessions.push(rest);
        queue.unshift(rest);
        t.hours = piece;
        t.plannedHours = piece;
        t.day = roomiest;
        load[roomiest] += piece;
        continue;
      }
    }
    const pool = fits.length ? fits : cands;
    let best = pool[0];
    for (const d of pool) if (load[d] < load[best] - EPS) best = d;
    t.day = best;
    load[best] += t.hours;
    if (t.offDay) t.reason += ' Placed on a non-study day: it is the only time before it is due.';
  }
  for (const t of sessions) delete t.dueOrder;
  return sessions.sort((a, b) => a.day - b.day || a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
}

// ---------- Whole-semester plan ----------

/**
 * Generate the full plan.
 * state.prefs: { studyDays[7], dailyMax, sessionLength }
 * state.blocked: ['YYYY-MM-DD', ...] one-off days off
 * state.taskEdits: { taskId: { day, hours } }
 * state.progress: { taskId: { status: 'done'|'missed'|'partial', doneHours } }
 * opts.currentWeek: weeks before it count unfinished hours as rolled forward.
 * opts.trackFromWeek: weeks before this (e.g. before the app was set up) are never auto-rolled.
 */
export function generatePlan(state, opts = {}) {
  const semester = state.semester;
  const weeks = buildWeeks(semester);
  const units = state.units || [];
  const n = units.length;
  const progress = state.progress || {};
  const prefs = normalizePrefs(state.prefs);
  const blocked = new Set(state.blocked || []);
  const currentWeek = opts.currentWeek ?? null;
  const trackFrom = opts.trackFromWeek ?? 1;
  const pending = {}; // week -> { unitId: hours }
  const addPending = (wk, unitId, h) => {
    if (h <= EPS) return;
    pending[wk] = pending[wk] || {};
    pending[wk][unitId] = (pending[wk][unitId] || 0) + h;
  };
  const regular = prefs.studyDays.map((on, d) => (on ? d : -1)).filter((d) => d >= 0);

  const outWeeks = [];
  for (const wi of weeks) {
    const requested = hoursForWeek(state, wi.week);
    const daysOff = regular.filter((d) => blocked.has(addDays(wi.start, d)));
    const allowed = regular.filter((d) => !daysOff.includes(d));
    const capRegular = prefs.dailyMax ? Math.min(requested, prefs.dailyMax * regular.length) : requested;
    const H = !allowed.length ? 0 : prefs.dailyMax ? Math.min(requested, prefs.dailyMax * allowed.length) : capRegular;
    const notes = [];
    if (prefs.dailyMax && capRegular < requested - EPS) {
      notes.push(`Only ${fmtH(capRegular)} of your ${fmtH(requested)} fit: ${plural(regular.length, 'study day')} × ${fmtH(prefs.dailyMax)} max.`);
    }

    const scored = units.map((unit, rank) => ({ unit, rank, s: scoreUnit(unit, rank, n, wi, semester) }));
    const carryIn = pending[wi.week] || {};
    const res = allocateWeek(scored, H, wi, carryIn);
    const { allocations, carryOut } = res;
    for (const [u, h] of Object.entries(carryOut)) addPending(wi.week + 1, u, h);

    // Days off: hours that no longer fit move to next week.
    if (daysOff.length) {
      const names = daysOff.map((d) => DAY_NAMES[d]);
      if (H < capRegular - EPS) {
        const ideal = allocateWeek(scored, capRegular, wi, carryIn);
        // Catch-up squeezed out by the smaller week is already carried on via carryOut; count it in the note.
        let moved = Math.max(0, sum(Object.values(carryOut)) - sum(Object.values(ideal.carryOut)));
        allocations.forEach((a, i) => {
          const lost = Math.max(0, ideal.allocations[i].fresh - a.fresh);
          if (lost > EPS) {
            addPending(wi.week + 1, a.unitId, lost);
            moved += lost;
            a.reasons.push(`${fmtH(lost)} moved to next week because of your day${daysOff.length > 1 ? 's' : ''} off.`);
          }
        });
        notes.push(`Day${daysOff.length > 1 ? 's' : ''} off: ${listAnd(names)}. ${fmtH(moved)} moved to next week.`);
      } else {
        notes.push(`Day${daysOff.length > 1 ? 's' : ''} off: ${listAnd(names)}. The hours are spread over your other days.`);
      }
    }

    const unitParts = allocations.map((a, i) => ({
      unit: units[i],
      parts: buildTaskParts(a, units[i], scored[i].s, wi, weeks),
    }));
    const tasks = scheduleDays(unitParts, wi, {
      allowedDays: allowed, dailyMax: prefs.dailyMax, sessionLength: prefs.sessionLength,
      edits: state.taskEdits, free: res.free,
    });

    // Keep allocations in step with any task hours the student edited.
    for (const a of allocations) {
      const total = sum(tasks.filter((t) => t.unitId === a.unitId), (t) => t.hours);
      const delta = Math.round((total - a.hours) * 100) / 100;
      if (Math.abs(delta) > EPS) {
        a.reasons[0] = a.reasons[0].replace(`gets ${fmtH(a.hours)}`, `gets ${fmtH(total)}`);
        a.reasons.push(delta < 0 ? `You shortened a task: ${fmtH(-delta)} less.` : `You lengthened a task: ${fmtH(delta)} more.`);
        a.hours = total;
        a.fresh += delta;
      }
    }

    // Unfinished work rolls forward (only the part not done).
    const past = currentWeek != null && wi.week < currentWeek && wi.week >= trackFrom;
    for (const t of tasks) {
      const p = progress[t.id] || {};
      t.doneHours = p.status === 'done' ? t.hours : clamp(Number(p.doneHours) || 0, 0, t.hours);
      const left = t.hours - t.doneHours;
      if (left > EPS && (p.status === 'missed' || past)) {
        addPending(Math.max(wi.week + 1, currentWeek ?? 0), t.unitId, left);
      }
    }

    const allocated = sum(allocations, (a) => a.hours);
    outWeeks.push({
      ...wi,
      requested,
      available: H,
      allocated,
      free: Math.max(0, Math.round((H - allocated) * 100) / 100),
      carriedIn: sum(Object.values(carryIn)),
      studyDays: allowed,
      daysOff,
      notes,
      allocations,
      tasks,
    });
  }

  const unscheduled = [];
  for (const [wk, byUnit] of Object.entries(pending)) {
    if (Number(wk) <= weeks.length) continue;
    for (const [unitId, h] of Object.entries(byUnit)) {
      const u = units.find((x) => x.id === unitId);
      unscheduled.push({ unitId, hours: h, reasons: [`${fmtH(h)} of ${u?.code || 'unit'} work could not fit before the semester ended.`] });
    }
  }

  const plan = { weeks: outWeeks, unscheduled, currentWeek };
  plan.unitSummaries = summarizeUnits(plan, state);
  return plan;
}

/** Semester-level summary for each unit, with plain-English reasons. */
export function summarizeUnits(plan, state) {
  const units = state.units || [];
  const n = units.length;
  const grand = sum(plan.weeks, (w) => w.allocated) || 1;
  const nowWeek = plan.currentWeek ?? Infinity;
  return units.map((unit, rank) => {
    const perWeek = plan.weeks.map((w) => ({ week: w.week, hours: w.allocations.find((a) => a.unitId === unit.id)?.hours || 0 }));
    const total = sum(perWeek, (x) => x.hours);
    const share = Math.round((total / grand) * 100);
    const assessments = (unit.assessments || []).map((a) => ({ ...a, due: resolveDue(a, state.semester) }));
    const totalWeight = sum(assessments, (a) => Number(a.weight) || 0);
    const biggest = [...assessments].sort((a, b) => (b.weight || 0) - (a.weight || 0))[0];
    const conf = confidenceFor(unit, nowWeek);
    const reasons = [`${unit.code} gets ${share}% of your study time (${fmtH(total)} across the semester).`];
    reasons.push(rank === 0 && n > 1 ? `Ranked hardest of ${n} units, so it gets the most time each week.`
      : rank === n - 1 && n > 1 ? `Ranked easiest of ${n} units, so it needs the least extra time.`
      : n > 1 ? `Ranked ${rank + 1} of ${n} for difficulty.` : 'Your only unit.');
    reasons.push(conf <= 2 ? `Confidence ${conf}/5: low confidence adds practice time.`
      : conf >= 4 ? `Confidence ${conf}/5: you feel solid, so less extra time.` : `Confidence ${conf}/5: average.`);
    if (biggest) reasons.push(`Assessments total ${totalWeight}%. Largest: ${biggest.name} (${biggest.weight}%, Week ${biggest.due.week}${biggest.due.tentative ? ', date TBC' : ''}).`);
    else reasons.push('No assessments entered yet, so time is based on difficulty and confidence only.');
    const tbc = assessments.filter((a) => a.due.tentative && !a.done);
    if (tbc.length) reasons.push(`Date not announced yet for ${listAnd(tbc.map((a) => a.name))}: planned for Week ${tbc[0].due.week} for now.`);
    if (unit.exam?.hurdle) reasons.push(`Hurdle: must score ${unit.exam.hurdle}% on the exam, so the exam counts ${WEIGHTS.hurdleMult}× when planning.`);
    const res = resultsBefore(unit, state.semester, Infinity);
    if (res) reasons.push(`Marks so far average ${Math.round(res.avg * 100)}% across ${plural(res.count, 'assessment')}${res.avg < RESULTS_TARGET ? ', so it gets extra time' : ''}.`);
    const outlook = examOutlook(unit);
    if (outlook) {
      const need = Math.ceil(outlook.needOverall);
      if (need > 100) reasons.push(`Passing overall would need more than 100% on the exam. Talk to your unit coordinator.`);
      else if (need <= 0) reasons.push(`You have already earned enough marks to pass overall${outlook.hurdle ? `, but you still need ${outlook.hurdle}% on the exam for the hurdle` : ''}.`);
      else reasons.push(`To pass overall you need about ${need}% on the exam${outlook.hurdle ? ` (and at least ${outlook.hurdle}% for the hurdle)` : ''}.`);
    }
    const rs = readinessSummary(unit, nowWeek);
    if (rs.count) {
      const bits = [];
      if (rs.ready.length) bits.push(`${rs.ready.length} ready`);
      if (rs.shaky.length) bits.push(`${weekList(rs.shaky)} shaky`);
      if (rs.notReady.length) bits.push(`${weekList(rs.notReady)} not ready yet`);
      reasons.push(`Week readiness: ${bits.join(', ')}.${rs.notReady.length || rs.shaky.length ? ' Weak weeks get extra review and lead your SWOTVAC revision.' : ''}`);
    }
    if (Number(unit.minHours) > 0) reasons.push(`You asked for at least ${fmtH(Number(unit.minHours))} a week.`);
    if (unit.maxHours != null && unit.maxHours !== '') reasons.push(`You limited it to ${fmtH(Number(unit.maxHours))} a week.`);
    if (unit.exam && unit.exam.pastPapers === false) reasons.push('No past papers, so exam prep uses exam-style questions instead.');
    const peaks = [...perWeek].sort((a, b) => b.hours - a.hours || a.week - b.week).slice(0, 2).filter((p) => p.hours > 0);
    if (peaks.length) reasons.push(`Busiest weeks: ${peaks.map((p) => `Week ${p.week} (${fmtH(p.hours)})`).join(', ')}.`);
    const solo = plan.weeks.filter((w) => w.type !== 'teaching' && w.type !== 'break' && n > 1
      && w.allocations.every((a) => (a.unitId === unit.id ? a.hours > 0 : a.hours === 0)));
    if (solo.length) reasons.push(`${listAnd(solo.map((w) => `Week ${w.week}`))} ${solo.length > 1 ? 'are' : 'is'} all ${unit.code}: its exam is the only one left.`);
    return { unitId: unit.id, code: unit.code, total, share, perWeek, reasons, outlook, results: res };
  });
}
