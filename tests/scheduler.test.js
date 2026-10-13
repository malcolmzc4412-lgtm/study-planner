import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePlan, defaultSemester, resolveDue, hoursForWeek, scoreUnit, buildWeeks,
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
