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
};
// Urgency ramp by weeks until due: due this week, 1, 2, 3 weeks away.
export const RAMP = [1, 0.8, 0.5, 0.25];
export const BASELINE_MAX = 2;      // hours per unit per teaching week
export const CAP_SHARE = 0.5;       // max share of a week for one unit
export const CATCHUP_SHARE = 0.5;   // max share of a week used for carried-forward work
export const SESSION_MAX = 2;       // longest single study session (hours)
export const REVIEW_GAPS = [1, 3, 7];

const EPS = 1e-9;
const floorHalf = (h) => Math.floor(h * 2 + EPS) / 2;
const fmtH = (h) => `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

/** Resolve an assessment's due week and day (0 = Mon). Week-only dues are assumed Friday. */
export function resolveDue(a, semester) {
  if (a.dueDate) {
    const diff = Math.round((parseISO(a.dueDate) - parseISO(semester.startDate)) / 86400000);
    return { week: Math.floor(diff / 7) + 1, day: ((diff % 7) + 7) % 7 };
  }
  return { week: Number(a.dueWeek) || 1, day: 4 };
}

export function isHurdled(a, unit) {
  return a.type === 'exam' && !!unit.exam?.hurdle;
}

function rankText(rank, n) {
  if (n === 1) return 'your only unit';
  if (rank === 0) return 'ranked hardest';
  if (rank === n - 1) return 'ranked easiest';
  const ord = ['1st', '2nd', '3rd'][rank] || `${rank + 1}th`;
  return `ranked ${ord} hardest of ${n}`;
}

// ---------- Scoring ----------

/**
 * Priority score for one unit in one week.
 * Returns { score, breakdown, active, upcoming, dueThisWeek, remaining }.
 */
export function scoreUnit(unit, rank, nUnits, weekInfo, semester) {
  const w = weekInfo.week;
  const all = (unit.assessments || []).map((a) => ({ ...a, due: resolveDue(a, semester) }));
  const remaining = all.filter((a) => a.due.week >= w).sort((a, b) => a.due.week - b.due.week || a.due.day - b.due.day);
  const studyWeek = weekInfo.type === 'teaching' || weekInfo.type === 'break';
  const active = studyWeek || remaining.length > 0;

  const conf = Math.min(5, Math.max(1, Number(unit.confidence) || 3));
  const breakdown = {
    base: WEIGHTS.base,
    difficulty: WEIGHTS.difficulty * (nUnits - rank) / nUnits,
    confidence: WEIGHTS.confidence * (5 - conf),
    weight: 0,
    urgency: 0,
    hurdle: 0,
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
  const score = Math.round(sum(Object.values(breakdown)) * 100) / 100;
  const dueThisWeek = remaining.filter((a) => a.due.week === w);
  return { score, breakdown, active, upcoming, dueThisWeek, remaining, conf };
}

// ---------- Allocation for one week ----------

/**
 * Split `H` hours between scored units.
 * scored: [{ unit, rank, s (scoreUnit result) }] in rank order.
 * carryIn: { unitId: hours } unfinished work waiting to be placed.
 * Returns { allocations, carryOut, free }.
 */
export function allocateWeek(scored, H, weekInfo, carryIn = {}) {
  const teaching = weekInfo.type === 'teaching';
  const n = scored.length;
  const rows = scored.map(({ unit, rank, s }) => ({
    unit, rank, s,
    cap: s.dueThisWeek.length ? H : CAP_SHARE * H,
    catchUp: 0, baseline: 0, share: 0, hours: 0,
    capped: false, capLifted: s.dueThisWeek.length > 0 && n > 1,
  }));
  const active = rows.filter((r) => r.s.active);
  const carryOut = {};

  // 1. Carried-forward work first, up to CATCHUP_SHARE of the week.
  let catchBudget = floorHalf(CATCHUP_SHARE * H);
  for (const r of rows) {
    const want = Number(carryIn[r.unit.id] || 0);
    if (want <= 0) continue;
    if (!r.s.active) { carryOut[r.unit.id] = (carryOut[r.unit.id] || 0) + want; continue; }
    const place = Math.min(floorHalf(Math.min(want, r.cap)), catchBudget);
    r.catchUp = place;
    catchBudget -= place;
    if (want - place > EPS) carryOut[r.unit.id] = (carryOut[r.unit.id] || 0) + (want - place);
  }
  const F = H - sum(rows, (r) => r.catchUp);

  // 2. Baseline per unit in teaching weeks.
  if (teaching && active.length) {
    const b = Math.min(BASELINE_MAX, floorHalf((F * 0.4) / active.length));
    for (const r of active) r.baseline = Math.max(0, Math.min(b, r.cap - r.catchUp));
  }

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
    parts.push(`${pick.weight}% ${pick.type}${hurdle} in Week ${pick.due.week}`);
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
  if (r.s.breakdown.hurdle > 0) reasons.push(`Hurdle: must score ${r.unit.exam.hurdle}% on the exam, so it counts ${WEIGHTS.hurdleMult}× when planning.`);
  if (r.baseline > 0) reasons.push(`Includes a ${fmtH(r.baseline)} baseline so lectures are not missed.`);
  if (r.capped) reasons.push(`Capped at ${CAP_SHARE * 100}% of this week's ${fmtH(H)} so other units still get time.`);
  else if (r.capLifted && r.hours > CAP_SHARE * H) reasons.push(`The ${CAP_SHARE * 100}% cap is lifted because ${r.s.dueThisWeek[0].name} is due this week.`);
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

const PRACTICE_TITLE = {
  calculations: 'Practice problems',
  mcq: 'MCQ drills',
  essays: 'Essay planning practice',
  mixed: 'Mixed practice questions',
};

/** Turn one unit's weekly allocation into task parts (before day assignment). */
export function buildTaskParts(alloc, unit, s, weekInfo, weeks) {
  const w = weekInfo.week;
  const parts = [];
  const practiceTitle = PRACTICE_TITLE[unit.exam?.format] || 'Practice problems';
  if (alloc.catchUp > 0) {
    parts.push({ kind: 'catchup', title: 'Catch up on unfinished work', w: 0, hours: alloc.catchUp, reason: 'Carried forward from missed or unfinished tasks.' });
  }
  const h = alloc.fresh;
  if (h <= 0) return parts;

  if (weekInfo.type === 'swotvac' || weekInfo.type === 'exam') {
    const target = s.remaining[0];
    if (!target) return parts;
    const papers = unit.exam?.pastPapers !== false;
    const openBook = unit.exam?.book === 'open';
    const split = splitHalves(h, [
      { kind: 'pastpaper', w: 0.6, title: papers ? `Timed past paper for ${target.name}` : `Exam-style questions for ${target.name}`,
        reason: papers ? `Past papers are the best prep for ${target.name} (Week ${target.due.week}).` : 'No past papers, so use exam-style practice questions instead.' },
      { kind: 'revision', w: 0.4, title: openBook ? `Build open-book notes for ${target.name}` : `Active-recall revision for ${target.name}`,
        reason: openBook ? 'Open book: organise notes and a formula sheet you can find things in fast.' : 'Closed book: practise recalling key ideas from memory.' },
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
    spec.push({ kind, w: frac, title, reason: `${soon.name} (${soon.weight}%) is ${when}.`, assessmentId: soon.id, due: soon.due });
  }
  const rest = 1 - sum(spec, (p) => p.w);
  const sources = REVIEW_GAPS
    .map((g) => ({ g, wk: weeks[w - 1 - g] }))
    .filter((x) => x.wk && x.wk.type === 'teaching');
  const teaching = weekInfo.type === 'teaching';
  const learnW = teaching ? 0.45 : 0;
  const reviewW = sources.length ? (teaching ? 0.2 : 0.5) : 0;
  const practiceW = 1 - learnW - reviewW;
  if (learnW) spec.push({ kind: 'learn', w: rest * learnW, title: 'Learn new content: lectures and notes', reason: `Keep up with Teaching week ${weekInfo.teachingIndex} content.` });
  spec.push({ kind: 'practice', w: rest * practiceW, title: practiceTitle, reason: `Exam format is ${unit.exam?.format || 'calculations'}, so practise that style.` });
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
  const reviews = usable.map((src) => ({ kind: 'review', w: 1,
    title: `Spaced review: Week ${src.wk.week} topics`,
    reason: `${plural(src.g, 'week')} since you learnt it, the right time to revisit.` }));
  for (const p of splitHalves(reviewHalves / 2, reviews)) if (p.hours > 0) parts.push(p);
  return parts;
}

/** Break parts into sessions (≤ SESSION_MAX) and place them on days. Deterministic. */
export function scheduleDays(unitParts, weekInfo) {
  const sessions = [];
  for (const { unit, parts } of unitParts) {
    for (const p of parts) {
      if (p.hours <= 0) continue;
      const n = Math.ceil(p.hours / SESSION_MAX - EPS);
      const chunks = splitHalves(p.hours, Array.from({ length: n }, () => ({ w: 1 })));
      chunks.forEach((c, i) => {
        if (c.hours <= 0) return;
        const maxDay = p.due && p.due.week === weekInfo.week ? p.due.day : 6;
        sessions.push({
          id: `w${weekInfo.week}-${unit.id}-${p.kind}-${p.assessmentId || 'g'}-${slug(p.title)}-${i}`,
          unitId: unit.id, code: unit.code, week: weekInfo.week, kind: p.kind, title: p.title,
          hours: c.hours, assessmentId: p.assessmentId || null, reason: p.reason, maxDay,
          dueOrder: p.due ? p.due.week * 7 + p.due.day : Infinity,
        });
      });
    }
  }
  // Most constrained first, then earliest due (orders exam prep by exam date).
  sessions.sort((a, b) => a.maxDay - b.maxDay || a.dueOrder - b.dueOrder || b.hours - a.hours || a.id.localeCompare(b.id));
  const load = Array(7).fill(0);
  for (const t of sessions) {
    let best = 0;
    for (let d = 1; d <= t.maxDay; d++) if (load[d] < load[best] - EPS) best = d;
    t.day = best;
    load[best] += t.hours;
  }
  for (const t of sessions) { delete t.maxDay; delete t.dueOrder; }
  return sessions.sort((a, b) => a.day - b.day || a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40);
}

// ---------- Whole-semester plan ----------

/**
 * Generate the full plan.
 * opts.currentWeek: weeks before it count unticked tasks as unfinished (rolled forward).
 * opts.trackFromWeek: weeks before this (e.g. before the app was set up) are never auto-rolled.
 * Tasks marked 'missed' in progress always roll forward.
 */
export function generatePlan(state, opts = {}) {
  const semester = state.semester;
  const weeks = buildWeeks(semester);
  const units = state.units || [];
  const n = units.length;
  const progress = state.progress || {};
  const currentWeek = opts.currentWeek ?? null;
  const trackFrom = opts.trackFromWeek ?? 1;
  const pending = {}; // week -> { unitId: hours }
  const addPending = (wk, unitId, h) => {
    if (h <= EPS) return;
    pending[wk] = pending[wk] || {};
    pending[wk][unitId] = (pending[wk][unitId] || 0) + h;
  };

  const outWeeks = [];
  for (const wi of weeks) {
    const H = hoursForWeek(state, wi.week);
    const scored = units.map((unit, rank) => ({ unit, rank, s: scoreUnit(unit, rank, n, wi, semester) }));
    const carryIn = pending[wi.week] || {};
    const { allocations, carryOut, free } = allocateWeek(scored, H, wi, carryIn);
    for (const [u, h] of Object.entries(carryOut)) addPending(wi.week + 1, u, h);

    const unitParts = allocations.map((a, i) => ({
      unit: units[i],
      parts: buildTaskParts(a, units[i], scored[i].s, wi, weeks),
    }));
    const tasks = scheduleDays(unitParts, wi);

    // Unfinished work rolls forward.
    for (const t of tasks) {
      const st = progress[t.id]?.status;
      const past = currentWeek != null && wi.week < currentWeek && wi.week >= trackFrom;
      if (st === 'missed' || (past && st !== 'done')) {
        const target = Math.max(wi.week + 1, currentWeek ?? 0);
        addPending(target, t.unitId, t.hours);
      }
    }

    outWeeks.push({
      ...wi,
      available: H,
      allocated: sum(allocations, (a) => a.hours),
      free,
      carriedIn: Object.values(carryIn).reduce((s, h) => s + h, 0),
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
  return units.map((unit, rank) => {
    const perWeek = plan.weeks.map((w) => ({ week: w.week, hours: w.allocations.find((a) => a.unitId === unit.id)?.hours || 0 }));
    const total = sum(perWeek, (x) => x.hours);
    const share = Math.round((total / grand) * 100);
    const assessments = (unit.assessments || []).map((a) => ({ ...a, due: resolveDue(a, state.semester) }));
    const totalWeight = sum(assessments, (a) => Number(a.weight) || 0);
    const biggest = [...assessments].sort((a, b) => (b.weight || 0) - (a.weight || 0))[0];
    const conf = Number(unit.confidence) || 3;
    const reasons = [`${unit.code} gets ${share}% of your study time (${fmtH(total)} across the semester).`];
    reasons.push(rank === 0 && n > 1 ? `Ranked hardest of ${n} units, so it gets the most time each week.`
      : rank === n - 1 && n > 1 ? `Ranked easiest of ${n} units, so it needs the least extra time.`
      : n > 1 ? `Ranked ${rank + 1} of ${n} for difficulty.` : 'Your only unit.');
    reasons.push(conf <= 2 ? `Confidence ${conf}/5: low confidence adds practice time.`
      : conf >= 4 ? `Confidence ${conf}/5: you feel solid, so less extra time.` : `Confidence ${conf}/5: average.`);
    if (biggest) reasons.push(`Assessments total ${totalWeight}%. Largest: ${biggest.name} (${biggest.weight}%, Week ${biggest.due.week}).`);
    else reasons.push('No assessments entered yet, so time is based on difficulty and confidence only.');
    if (unit.exam?.hurdle) reasons.push(`Hurdle: must score ${unit.exam.hurdle}% on the exam, so the exam counts ${WEIGHTS.hurdleMult}× when planning.`);
    if (unit.exam && unit.exam.pastPapers === false) reasons.push('No past papers, so exam prep uses exam-style questions instead.');
    const peaks = [...perWeek].sort((a, b) => b.hours - a.hours || a.week - b.week).slice(0, 2).filter((p) => p.hours > 0);
    if (peaks.length) reasons.push(`Busiest weeks: ${peaks.map((p) => `Week ${p.week} (${fmtH(p.hours)})`).join(', ')}.`);
    const solo = plan.weeks.filter((w) => w.type !== 'teaching' && w.type !== 'break' && n > 1
      && w.allocations.every((a) => (a.unitId === unit.id ? a.hours > 0 : a.hours === 0)));
    if (solo.length) reasons.push(`${solo.map((w) => `Week ${w.week}`).join(' and ')} ${solo.length > 1 ? 'are' : 'is'} all ${unit.code}: its exam is the only one left.`);
    return { unitId: unit.id, code: unit.code, total, share, perWeek, reasons };
  });
}
