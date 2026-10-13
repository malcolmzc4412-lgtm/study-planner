import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePlan, defaultSemester, resolveDue, hoursForWeek, scoreUnit, buildWeeks,
  confidenceFor, examOutlook, splitSessions, addDays, readinessFor,
} from '../scheduler.js';

const START = '2027-03-01';

function unit(id, code, opts = {}) {
  return {
    id, code, name: '', confidence: opts.confidence ?? 3,
    exam: { book: 'closed', format: 'calculations', hurdle: opts.hurdle ?? null, pastPapers: true },
    assessments: opts.assessments ?? [
      { id: `${id}-a1`, name: 'Assignment 1', type: 'assignment', weight: 20, dueWeek: 6 },
      { id: `${id}-ex`, name: 'Final exam', type: 'exam', weight: 60, dueWeek: 15 },
    ],
  };
}

function baseState(units, extra = {}) {
  return {
    semester: defaultSemester(START),
    hours: { perWeek: 20, overrides: {} },
    units,
    progress: {},
    ...extra,
  };
}

// The three example units from the brief.
function exampleState() {
  return baseState([
    unit('eng', 'ENG2005', { confidence: 2, hurdle: 45, assessments: [
      { id: 'eng-a1', name: 'Assignment 1', type: 'assignment', weight: 15, dueWeek: 5 },
      { id: 'eng-t1', name: 'Mid-sem test', type: 'test', weight: 15, dueWeek: 8 },
      { id: 'eng-a2', name: 'Assignment 2', type: 'assignment', weight: 20, dueDate: '2027-05-19' },
      { id: 'eng-ex', name: 'Final exam', type: 'exam', weight: 50, dueWeek: 15 },
    ] }),
    unit('mte', 'MTE2204', { confidence: 3, assessments: [
      { id: 'mte-l1', name: 'Lab report 1', type: 'lab', weight: 10, dueWeek: 4 },
      { id: 'mte-q1', name: 'Quiz', type: 'quiz', weight: 10, dueWeek: 7 },
      { id: 'mte-l2', name: 'Lab report 2', type: 'lab', weight: 20, dueWeek: 11 },
      { id: 'mte-ex', name: 'Final exam', type: 'exam', weight: 60, dueWeek: 14 },
    ] }),
    unit('ecw', 'ECW1102', { confidence: 4, assessments: [
      { id: 'ecw-a1', name: 'Report', type: 'assignment', weight: 30, dueWeek: 9 },
      { id: 'ecw-ex', name: 'Final exam', type: 'exam', weight: 70, dueWeek: 16 },
    ] }),
  ]);
}

const unitHours = (plan, unitId, weeks = null) =>
  plan.weeks.filter((w) => !weeks || weeks.includes(w.week))
    .reduce((s, w) => s + (w.allocations.find((a) => a.unitId === unitId)?.hours || 0), 0);

test('hardest unit gets the most hours (all else equal)', () => {
  const state = baseState([unit('a', 'AAA1001'), unit('b', 'BBB1001'), unit('c', 'CCC1001')]);
  const plan = generatePlan(state);
  const [a, b, c] = ['a', 'b', 'c'].map((id) => unitHours(plan, id));
  assert.ok(a > b && b > c, `expected a > b > c, got ${a}, ${b}, ${c}`);
  // Also true in a typical teaching week.
  const w2 = plan.weeks[1].allocations;
  assert.ok(w2[0].hours >= w2[1].hours && w2[1].hours >= w2[2].hours);
});

test('urgency ramps up in the weeks before an assessment', () => {
  const state = baseState([
    unit('a', 'AAA1001', { assessments: [
      { id: 'a1', name: 'Big assignment', type: 'assignment', weight: 40, dueWeek: 8 },
      { id: 'ax', name: 'Final exam', type: 'exam', weight: 60, dueWeek: 15 },
    ] }),
    unit('b', 'BBB1001', { assessments: [{ id: 'bx', name: 'Final exam', type: 'exam', weight: 100, dueWeek: 15 }] }),
  ]);
  // Put the unit with the assignment second so rank does not cause the effect.
  state.units.reverse();
  const plan = generatePlan(state);
  const h = (wk) => unitHours(plan, 'a', [wk]);
  assert.ok(h(5) <= h(6) && h(6) <= h(7) && h(7) <= h(8), `ramp ${h(4)},${h(5)},${h(6)},${h(7)},${h(8)}`);
  assert.ok(h(8) > h(4), 'due week gets more than a quiet week');
  assert.ok(h(9) < h(8), 'drops after the assessment');
  const weeks = buildWeeks(state.semester);
  const u = state.units[1];
  const urg = [4, 5, 6, 7, 8].map((wk) => scoreUnit(u, 1, 2, weeks[wk - 1], state.semester).breakdown.urgency);
  assert.deepEqual([...urg].sort((x, y) => x - y), urg, 'urgency score is non-decreasing');
  assert.equal(urg[0], 0);
  const reasons = plan.weeks[6].allocations.find((x) => x.unitId === 'a').reasons.join(' ');
  assert.match(reasons, /Ramping up for Big assignment/);
});

test('nothing is scheduled for an assessment after its due date', () => {
  const state = exampleState();
  const plan = generatePlan(state);
  const all = new Map(state.units.flatMap((u) => u.assessments.map((a) => [a.id, resolveDue(a, state.semester)])));
  let tied = 0;
  for (const w of plan.weeks) {
    for (const t of w.tasks) {
      if (!t.assessmentId) continue;
      tied++;
      const due = all.get(t.assessmentId);
      assert.ok(t.week < due.week || (t.week === due.week && t.day <= due.day),
        `${t.title} in week ${t.week} day ${t.day} after due week ${due.week} day ${due.day}`);
    }
  }
  assert.ok(tied > 10, 'some tasks are tied to assessments');
  // Once a unit's last exam is done it gets no exam-period time.
  assert.equal(unitHours(plan, 'mte', [15, 16]), 0);
});

test('weekly total never exceeds available hours', () => {
  const state = exampleState();
  state.hours = { perWeek: 17.3, overrides: { 3: 4, 6: 0, 9: 7.5, 13: 30 } };
  // Mark a lot of work missed to stress catch-up.
  let plan = generatePlan(state);
  for (const t of [...plan.weeks[1].tasks, ...plan.weeks[4].tasks]) state.progress[t.id] = { status: 'missed' };
  for (const opts of [{}, { currentWeek: 8 }]) {
    plan = generatePlan(state, opts);
    for (const w of plan.weeks) {
      const allocated = w.allocations.reduce((s, a) => s + a.hours, 0);
      const tasked = w.tasks.reduce((s, t) => s + t.hours, 0);
      const H = hoursForWeek(state, w.week);
      assert.ok(allocated <= H + 1e-9, `week ${w.week}: ${allocated} > ${H}`);
      assert.ok(Math.abs(tasked - allocated) < 1e-9, `week ${w.week}: tasks ${tasked} != allocations ${allocated}`);
      for (const a of w.allocations) {
        const dueNow = state.units.find((u) => u.id === a.unitId).assessments
          .some((x) => resolveDue(x, state.semester).week === w.week);
        if (!dueNow) assert.ok(a.hours <= H * 0.5 + 1e-9, `week ${w.week} ${a.code} over 50% cap`);
      }
    }
  }
});

test('missed hours roll forward and are not dropped', () => {
  const state = exampleState();
  const before = generatePlan(state);
  const missed = before.weeks[2].tasks.filter((t) => t.unitId === 'eng');
  const missedHours = missed.reduce((s, t) => s + t.hours, 0);
  assert.ok(missedHours > 0);
  for (const t of missed) state.progress[t.id] = { status: 'missed' };
  const after = generatePlan(state);
  const catchUp = after.weeks.slice(3).reduce((s, w) => s + (w.allocations.find((a) => a.unitId === 'eng')?.catchUp || 0), 0);
  const unsched = after.unscheduled.filter((u) => u.unitId === 'eng').reduce((s, u) => s + u.hours, 0);
  assert.equal(catchUp + unsched, missedHours);
  assert.ok(after.weeks[3].allocations.find((a) => a.unitId === 'eng').catchUp > 0, 'starts next week');
  assert.ok(after.weeks[3].tasks.some((t) => t.kind === 'catchup' && t.unitId === 'eng'));
  // Earlier weeks are unchanged.
  assert.deepEqual(after.weeks[1].tasks, before.weeks[1].tasks);
});

test('unfinished work from past weeks rolls into the current week', () => {
  const state = exampleState();
  const plan0 = generatePlan(state);
  for (const t of plan0.weeks[0].tasks) state.progress[t.id] = { status: 'done' };
  const plan = generatePlan(state, { currentWeek: 3 });
  const week2Hours = plan.weeks[1].allocated;
  const carried = plan.weeks.slice(2).reduce((s, w) => s + w.allocations.reduce((x, a) => x + a.catchUp, 0), 0)
    + plan.unscheduled.reduce((s, u) => s + u.hours, 0);
  assert.equal(carried, week2Hours, 'week 2 unticked, week 1 done');
  assert.equal(plan.weeks[1].allocations.reduce((s, a) => s + a.catchUp, 0), 0, 'nothing lands in a past week');
});

test('weeks before the app was set up are not rolled forward', () => {
  const plan = generatePlan(exampleState(), { currentWeek: 6, trackFromWeek: 6 });
  assert.equal(plan.weeks.reduce((s, w) => s + w.allocations.reduce((x, a) => x + a.catchUp, 0), 0), 0);
});

test('every allocation has at least one reason', () => {
  const state = exampleState();
  state.hours.overrides = { 4: 0 };
  const plan = generatePlan(state);
  for (const w of plan.weeks) {
    assert.equal(w.allocations.length, state.units.length);
    for (const a of w.allocations) {
      assert.ok(Array.isArray(a.reasons) && a.reasons.length >= 1, `week ${w.week} ${a.code}`);
      assert.ok(a.reasons.every((r) => typeof r === 'string' && r.length > 0));
    }
  }
  const first = plan.weeks[14].allocations.find((a) => a.unitId === 'eng').reasons[0];
  assert.match(first, /^ENG2005 gets [\d.]+h: ranked hardest, confidence 2\/5, 50% exam with hurdle in Week 15\.$/);
  for (const s of plan.unitSummaries) assert.ok(s.reasons.length >= 3);
});

test('SWOTVAC and exam weeks only contain past papers, revision or catch-up', () => {
  const plan = generatePlan(exampleState());
  const kinds = new Set(plan.weeks.filter((w) => w.type === 'swotvac' || w.type === 'exam').flatMap((w) => w.tasks.map((t) => t.kind)));
  for (const k of kinds) assert.ok(['pastpaper', 'revision', 'catchup'].includes(k), k);
  assert.ok(kinds.has('pastpaper'));
});

test('spaced review revisits topics 1, 3 and 7 weeks later', () => {
  const plan = generatePlan(exampleState());
  const titles = plan.weeks[7].tasks.filter((t) => t.kind === 'review').map((t) => t.title);
  for (const wk of [7, 5, 1]) assert.ok(titles.some((t) => t.includes(`Week ${wk} `)), `week 8 reviews week ${wk}: ${titles}`);
});

test('task ids are unique and plan is deterministic', () => {
  const a = generatePlan(exampleState());
  const b = generatePlan(exampleState());
  assert.deepEqual(a, b);
  const ids = a.weeks.flatMap((w) => w.tasks.map((t) => t.id));
  assert.equal(new Set(ids).size, ids.length);
});

// ---------- User-customisable features ----------

const allTasks = (plan) => plan.weeks.flatMap((w) => w.tasks);
const sumH = (xs) => xs.reduce((s, t) => s + t.hours, 0);

test('1. assessments with unknown dates go in Week 14 (or the chosen week) and say so', () => {
  const state = exampleState();
  const ex = state.units[2].assessments.find((a) => a.id === 'ecw-ex');
  ex.tbc = true;
  assert.equal(resolveDue(ex, state.semester).week, 14);
  assert.equal(resolveDue(ex, state.semester).tentative, true);
  const plan = generatePlan(state);
  const r = plan.weeks[11].allocations.find((a) => a.unitId === 'ecw').reasons.join(' ');
  assert.match(r, /Final exam date not announced yet: planned for Week 14 for now\./);
  assert.ok(plan.unitSummaries[2].reasons.some((s) => /Date not announced yet for Final exam/.test(s)));
  assert.equal(unitHours(plan, 'ecw', [15, 16]), 0, 'no time after the tentative date');
  // The tentative week is configurable and clamped to the semester.
  state.semester.tentativeWeek = 13;
  assert.equal(resolveDue(ex, state.semester).week, 13);
  state.semester.tentativeWeek = 99;
  assert.equal(resolveDue(ex, state.semester).week, 16);
});

test('2. finished assessments get no more work; low marks add time; exam outlook', () => {
  const state = exampleState();
  const a1 = state.units[0].assessments.find((a) => a.id === 'eng-a1');
  a1.done = true;
  let plan = generatePlan(state);
  assert.equal(allTasks(plan).filter((t) => t.assessmentId === 'eng-a1').length, 0);
  const before = generatePlan(exampleState());
  a1.score = 9; a1.outOf = 30; // 30%
  plan = generatePlan(state);
  assert.ok(plan.weeks[6].allocations[0].breakdown.results > 0);
  const later = [6, 7, 8, 9, 10, 11, 12];
  assert.ok(unitHours(plan, 'eng', later) > unitHours(before, 'eng', later));
  assert.equal(plan.weeks[3].allocations[0].breakdown.results, 0, 'marks only count after the assessment');
  assert.match(plan.weeks[6].allocations[0].reasons.join(' '), /Marks so far average 30%, so it gets extra time/);
  // Once every non-exam assessment is marked, show what the exam needs.
  for (const a of state.units[0].assessments) if (a.type !== 'exam') { a.score = 15; a.outOf = 30; }
  const o = examOutlook(state.units[0]);
  assert.equal(Math.round(o.needOverall), 50);
  assert.ok(generatePlan(state).unitSummaries[0].reasons.some((s) => /you need about 50% on the exam \(and at least 45% for the hurdle\)/.test(s)));
});

test('3. weekly topics name learn and review tasks without changing task ids', () => {
  const state = exampleState();
  const before = generatePlan(state);
  state.units[0].topics = { 1: 'Vectors', 5: 'Laplace transforms', 8: 'Fourier series' };
  const plan = generatePlan(state);
  const titles = plan.weeks[7].tasks.filter((t) => t.unitId === 'eng').map((t) => t.title);
  for (const want of ['Learn: Fourier series', 'Review: Laplace transforms', 'Review: Vectors']) {
    assert.ok(titles.includes(want), `${want} in ${titles}`);
  }
  assert.deepEqual(plan.weeks[7].tasks.map((t) => t.id), before.weeks[7].tasks.map((t) => t.id));
});

test('4. study days and a daily limit are respected', () => {
  const state = exampleState();
  state.prefs = { studyDays: [true, true, true, true, true, false, false], dailyMax: 3 };
  const plan = generatePlan(state);
  for (const w of plan.weeks) {
    assert.ok(w.allocated <= 15 + 1e-9, `week ${w.week}: ${w.allocated}h > 5 days × 3h`);
    const perDay = Array(7).fill(0);
    for (const t of w.tasks) {
      perDay[t.day] += t.hours;
      assert.ok(t.day <= 4 || t.offDay, `week ${w.week}: ${t.title} on a weekend`);
    }
    perDay.forEach((h, d) => assert.ok(h <= 3 + 1e-9, `week ${w.week} day ${d}: ${h}h`));
  }
  assert.match(plan.weeks[0].notes.join(' '), /Only 15h of your 20h fit: 5 study days × 3h max\./);
});

test('5. days off: nothing planned that day; lost hours move to next week', () => {
  const state = exampleState();
  const mon3 = buildWeeks(state.semester)[2].start;
  // Without a daily limit the hours squeeze onto the other days.
  state.blocked = [mon3];
  let plan = generatePlan(state);
  assert.equal(plan.weeks[2].allocated, 20);
  assert.ok(plan.weeks[2].tasks.every((t) => t.day !== 0));
  assert.match(plan.weeks[2].notes.join(' '), /Day off: Mon\. The hours are spread/);
  // With a 4h daily limit, Mon–Wed off leaves 4 days × 4h = 16h; the rest moves on.
  state.prefs = { dailyMax: 4 };
  state.blocked = [mon3, addDays(mon3, 1), addDays(mon3, 2)];
  const base = generatePlan({ ...state, blocked: [] });
  plan = generatePlan(state);
  assert.equal(plan.weeks[2].available, 16);
  assert.ok(plan.weeks[2].tasks.every((t) => t.day >= 3));
  const moved = plan.weeks[3].allocations.reduce((s, a) => s + a.catchUp, 0);
  assert.equal(moved, base.weeks[2].allocated - plan.weeks[2].allocated);
  assert.match(plan.weeks[2].notes.join(' '), /Days off: Mon, Tue and Wed\. 4h moved to next week\./);
});

test('6. session length limits every task', () => {
  for (const len of [0.75, 1, 1.5, 3]) {
    const state = exampleState();
    state.prefs = { sessionLength: len };
    const plan = generatePlan(state);
    for (const t of allTasks(plan)) assert.ok(t.hours <= len + 1e-9, `${t.hours} > ${len}`);
    for (const w of plan.weeks) assert.equal(sumH(w.tasks), w.allocated);
  }
  assert.deepEqual(splitSessions(2, 0.75), [0.75, 0.75, 0.5]);
});

test('7. partial progress: only the unfinished part rolls forward', () => {
  const state = exampleState();
  const t = generatePlan(state).weeks[2].tasks.find((x) => x.unitId === 'eng' && x.hours >= 1.5);
  state.progress[t.id] = { status: 'missed', doneHours: 1 };
  const plan = generatePlan(state);
  const carried = plan.weeks.slice(3).reduce((s, w) => s + w.allocations.find((a) => a.unitId === 'eng').catchUp, 0);
  assert.equal(carried, t.hours - 1);
  // In a finished week, a partly-done task rolls only its remainder.
  const s2 = exampleState();
  const t2 = generatePlan(s2).weeks[2].tasks[0];
  s2.progress[t2.id] = { status: 'partial', doneHours: 0.5 };
  const p2 = generatePlan(s2, { currentWeek: 4, trackFromWeek: 3 });
  const rolled = p2.weeks.slice(3).reduce((s, w) => s + w.allocations.reduce((x, a) => x + a.catchUp, 0), 0)
    + p2.unscheduled.reduce((s, u) => s + u.hours, 0);
  assert.equal(rolled, p2.weeks[2].allocated - 0.5);
});

test('8. moved and resized tasks are kept, and the rest is planned around them', () => {
  const state = exampleState();
  const w = generatePlan(state).weeks[4]; // Week 5: ENG Assignment 1 due Friday
  const loose = w.tasks.find((t) => !t.assessmentId);
  const tied = w.tasks.find((t) => t.assessmentId === 'eng-a1');
  state.taskEdits = {
    [loose.id]: { day: 6 },
    [tied.id]: { day: 6, hours: tied.hours + 100 }, // try to move past the due day and over-grow
  };
  const pw = generatePlan(state).weeks[4];
  assert.equal(pw.tasks.find((t) => t.id === loose.id).day, 6);
  assert.equal(pw.tasks.find((t) => t.id === tied.id).day, 4, 'clamped to the due day');
  assert.ok(pw.allocated <= 20 + 1e-9);
  assert.equal(sumH(pw.tasks), pw.allocated);
  // Shortening a task lowers the week total and says so.
  state.taskEdits = { [loose.id]: { hours: 0.5 } };
  const p2 = generatePlan(state).weeks[4];
  assert.equal(p2.allocated, 20 - (loose.hours - 0.5));
  assert.ok(p2.allocations.find((a) => a.unitId === loose.unitId).reasons.some((r) => /You shortened a task/.test(r)));
});

test('9. weekly confidence check-ins change later weeks only', () => {
  const state = exampleState();
  const before = generatePlan(state);
  state.units[2].confidenceLog = [{ week: 6, value: 1 }];
  assert.equal(confidenceFor(state.units[2], 5), 4);
  assert.equal(confidenceFor(state.units[2], 6), 1);
  const plan = generatePlan(state);
  assert.deepEqual(plan.weeks[4], before.weeks[4], 'Week 5 unchanged');
  assert.ok(unitHours(plan, 'ecw', [6, 7]) > unitHours(before, 'ecw', [6, 7]));
});

test('10. per-unit minimum and maximum hours', () => {
  const state = exampleState();
  state.units[2].minHours = 6;
  state.units[0].maxHours = 5;
  const plan = generatePlan(state);
  for (const w of plan.weeks) {
    const eng = w.allocations.find((a) => a.unitId === 'eng');
    const ecw = w.allocations.find((a) => a.unitId === 'ecw');
    assert.ok(eng.hours <= 5 + 1e-9, `week ${w.week} ENG ${eng.hours}`);
    if (w.type === 'teaching') assert.ok(ecw.hours >= 6 - 1e-9, `week ${w.week} ECW ${ecw.hours}`);
    assert.ok(w.allocated <= 20 + 1e-9);
  }
  assert.ok(plan.weeks[1].allocations[0].reasons.some((r) => /Capped at your limit of 5h a week/.test(r)));
  assert.ok(plan.weeks[1].allocations[2].reasons.some((r) => /You asked for at least 6h a week/.test(r)));
});


test('all features at once: core rules still hold', () => {
  const state = exampleState();
  const weeks = buildWeeks(state.semester);
  state.prefs = { studyDays: [true, true, true, true, false, true, false], dailyMax: 4, sessionLength: 0.75 };
  state.blocked = [weeks[4].start, addDays(weeks[9].start, 3)];
  state.units[1].assessments[3].tbc = true;
  state.units[0].assessments[0].done = true;
  state.units[0].assessments[0].score = 12;
  state.units[0].assessments[0].outOf = 30;
  state.units[2].minHours = 3;
  state.units[1].maxHours = 4;
  state.units[0].confidenceLog = [{ week: 7, value: 4 }];
  let plan = generatePlan(state);
  plan.weeks[2].tasks.slice(0, 4).forEach((t, i) => { state.progress[t.id] = { status: i % 2 ? 'missed' : 'partial', doneHours: 0.5 }; });
  state.taskEdits = { [plan.weeks[3].tasks[0].id]: { day: 6, hours: 3 } };
  plan = generatePlan(state, { currentWeek: 6, trackFromWeek: 2 });
  const due = new Map(state.units.flatMap((u) => u.assessments.map((a) => [a.id, resolveDue(a, state.semester)])));
  for (const w of plan.weeks) {
    assert.ok(w.allocated <= hoursForWeek(state, w.week) + 1e-9);
    assert.ok(w.allocated <= w.available + 1e-9);
    assert.ok(Math.abs(sumH(w.tasks) - w.allocated) < 1e-9);
    for (const a of w.allocations) assert.ok(a.reasons.length >= 1);
    for (const t of w.tasks) {
      if (!t.assessmentId) continue;
      const d = due.get(t.assessmentId);
      assert.ok(t.week < d.week || (t.week === d.week && t.day <= d.day));
    }
  }
});


// ---------- Week readiness ----------

const reviewWeeksOf = (w, unitId) => w.tasks.filter((t) => t.unitId === unitId && t.kind === 'review').map((t) => t.reviewWeek);

test('readiness: weak weeks get extra review, ready weeks skip later reviews', () => {
  const state = exampleState();
  const before = generatePlan(state);
  // In Week 9 the spaced reviews are Weeks 8, 6 and 2.
  assert.deepEqual([...new Set(reviewWeeksOf(before.weeks[8], 'eng'))].sort((a, b) => a - b), [2, 6, 8]);
  state.units[0].readiness = { 3: { v: 1, at: 4 }, 4: { v: 2, at: 5 }, 6: { v: 3, at: 7 } };
  const plan = generatePlan(state);
  const w9 = plan.weeks[8];
  const reviewed = new Set(reviewWeeksOf(w9, 'eng'));
  assert.ok(reviewed.has(3) && reviewed.has(4), `weak weeks reviewed: ${[...reviewed]}`);
  assert.ok(!reviewed.has(6), 'Week 6 rated ready skips its 3-week review');
  assert.ok(w9.tasks.some((t) => t.title === 'Rework: Week 3 topics'));
  assert.ok(w9.tasks.some((t) => t.title === 'Shore up: Week 4 topics'));
  const reviewH = (p) => p.weeks[8].tasks.filter((t) => t.unitId === 'eng' && t.kind === 'review').reduce((s, t) => s + t.hours, 0);
  assert.ok(reviewH(plan) > reviewH(before), 'more review time overall');
  const eng = w9.allocations.find((a) => a.unitId === 'eng');
  assert.ok(eng.breakdown.readiness > 0);
  assert.ok(eng.reasons.some((r) => r === 'You rated Week 3 not ready yet and Week 4 shaky, so those weeks get extra review.'));
  assert.ok(unitHours(plan, 'eng', [9, 10, 11, 12]) > unitHours(before, 'eng', [9, 10, 11, 12]));
});

test('readiness: ratings only change the plan from the week they were made', () => {
  const state = exampleState();
  const before = generatePlan(state);
  state.units[0].readiness = { 2: { v: 1, at: 6 } };
  assert.equal(readinessFor(state.units[0], 2, 5), null);
  assert.equal(readinessFor(state.units[0], 2, 6), 1);
  const plan = generatePlan(state);
  for (let i = 0; i < 5; i++) assert.deepEqual(plan.weeks[i], before.weeks[i], `Week ${i + 1} unchanged`);
  assert.notDeepEqual(plan.weeks[5], before.weeks[5]);
});

test('readiness: SWOTVAC revision starts with the weakest weeks', () => {
  const state = exampleState();
  state.units[0].topics = { 5: 'Laplace transforms' };
  state.units[0].readiness = { 5: { v: 1, at: 6 }, 9: { v: 2, at: 10 } };
  const plan = generatePlan(state);
  const rev = plan.weeks[12].tasks.find((t) => t.unitId === 'eng' && t.kind === 'revision');
  assert.equal(rev.title, 'Revise weak spots: Laplace transforms and Week 9');
  assert.match(rev.reason, /You rated Weeks 5 and 9 not ready or shaky/);
  assert.ok(plan.unitSummaries[0].reasons.some((r) => /Week readiness: Week 9 shaky, Week 5 not ready yet\./.test(r)));
});
