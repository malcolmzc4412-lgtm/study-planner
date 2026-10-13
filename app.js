// Study Planner UI. Renders views as HTML strings and handles events by delegation.
import {
  generatePlan, defaultSemester, buildWeeks, weekForDate, hoursForWeek, resolveDue, scoreUnit,
  DAY_NAMES, ASSESSMENT_TYPES, mondayOf, addDays, isHurdled, tentativeWeekOf, confidenceFor, markPct,
  normalizePrefs, SESSION_CHOICES, DEFAULT_TENTATIVE_WEEK,
} from './scheduler.js';
import { loadState, saveState, clearState, requestPersistence } from './db.js';

const root = document.getElementById('app');
let state = null;
let plan = null;
const ui = { tab: 'week', week: null, unitId: null, viewKey: '', open: {} };

// ---------- Helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtH = (h) => (h > 0 && h < 1 ? `${Math.round(h * 60)}m` : `${Math.round(h * 100) / 100}h`);
const fmtSession = (h) => (h < 1 ? `${Math.round(h * 60)}m` : `${h}h`);
const uid = () => Math.random().toString(36).slice(2, 10);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pad = (n) => String(n).padStart(2, '0');
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDate(iso, opts = { day: 'numeric', month: 'short' }) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', opts);
}
const unitColor = (u) => `--uc:var(--c${(u?.color ?? 0) % 10})`;
const unitById = (id) => state.units.find((u) => u.id === id);
const weeksInfo = () => buildWeeks(state.semester);
const TYPE_SHORT = { teaching: 'Teaching', break: 'Break', swotvac: 'SWOTVAC', exam: 'Exams' };
const FORMATS = { calculations: 'Calculations', mcq: 'Multiple choice', essays: 'Essays', mixed: 'Mixed' };

/** Raw current week number from today's date (may be outside the semester). */
function rawCurrentWeek() {
  return weekForDate(state.semester, todayISO());
}
function displayWeek() {
  const n = state.semester.weeks.length;
  return clamp(rawCurrentWeek(), 1, n);
}

function recompute() {
  const raw = rawCurrentWeek();
  const n = state.semester.weeks.length;
  plan = generatePlan(state, { currentWeek: raw < 1 ? null : Math.min(raw, n + 1), trackFromWeek: state.onboarded ? (state.trackFrom ?? 1) : Math.max(1, raw) });
}

async function commit() {
  recompute();
  render();
  try { await saveState(state); } catch (e) { toast('Could not save on this device'); console.warn(e); }
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast glass';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.append(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 450); }, 2200);
}

// ---------- Icons ----------

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const ICON = {
  week: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5L7.5 17"/>'),
  plan: svg('<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7 13.5h3M14 13.5h3M7 17h3"/>'),
  units: svg('<path d="M4 19.5V5a2 2 0 0 1 2-2h4v18H6a2 2 0 0 1-2-1.5z"/><path d="M10 3h4v18h-4M14 4.5l3.8-1 3.2 16.5-3.8.9z"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  chev: svg('<path d="M9 5l7 7-7 7"/>', 'class="chev" stroke-width="2.5"'),
  back: svg('<path d="M15 4l-8 8 8 8"/>', 'stroke-width="2.6"'),
  left: svg('<path d="M15 5l-7 7 7 7"/>', 'stroke-width="2.6"'),
  right: svg('<path d="M9 5l7 7-7 7"/>', 'stroke-width="2.6"'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'stroke-width="3.2"'),
  handle: svg('<path d="M4 8h16M4 12h16M4 16h16"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.4"'),
  diamond: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0l5 5-5 5-5-5z" fill="currentColor"/></svg>',
  brain: svg('<path d="M12 3v18M8 7a3 3 0 1 0-3 5 3 3 0 0 0 3 5M16 7a3 3 0 1 1 3 5 3 3 0 0 1-3 5"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  plane: svg('<path d="M10.5 13.5L3 11l1.5-1.5 7.5 1L16.5 6a2 2 0 0 1 3 3L15 13.5l1 7.5-1.5 1.5-2.5-7.5-3 3V20l-1.5 1-1-3.5L3 16.5 4 15h2.5z"/>'),
};

// ---------- State ----------

function freshState() {
  return {
    version: 1,
    onboarded: false,
    obStep: 0,
    obUnit: 0,
    semester: defaultSemester(todayISO()),
    hours: { perWeek: 20, overrides: {} },
    prefs: normalizePrefs(),
    blocked: [],
    units: [],
    progress: {},
    taskEdits: {},
    checkins: {},
  };
}

const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function normalizeReadiness(r) {
  if (!r || typeof r !== 'object') return {};
  const out = {};
  for (const [k, x] of Object.entries(r)) {
    const v = Number(typeof x === 'object' && x ? x.v : x);
    if (Number(k) >= 1 && v >= 1 && v <= 3) out[k] = { v, at: typeof x === 'object' && x.at != null ? Number(x.at) : null };
  }
  return out;
}

function normalize(s) {
  const base = freshState();
  const out = { ...base, ...s };
  out.semester = { ...base.semester, ...(s.semester || {}) };
  if (!Array.isArray(out.semester.weeks) || !out.semester.weeks.length) out.semester.weeks = base.semester.weeks;
  out.hours = { perWeek: Number(s.hours?.perWeek ?? 20), overrides: { ...(s.hours?.overrides || {}) } };
  out.prefs = normalizePrefs(s.prefs);
  out.blocked = Array.isArray(s.blocked) ? [...new Set(s.blocked.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort() : [];
  out.units = (s.units || []).map((u, i) => ({
    id: u.id || uid(), code: String(u.code || `UNIT${i + 1}`), name: u.name || '',
    confidence: clamp(Number(u.confidence) || 3, 1, 5), color: u.color ?? i,
    confidenceLog: Array.isArray(u.confidenceLog) ? u.confidenceLog.filter((e) => e && Number(e.week) && Number(e.value)) : [],
    topics: u.topics && typeof u.topics === 'object' ? { ...u.topics } : {},
    readiness: normalizeReadiness(u.readiness),
    minHours: numOrNull(u.minHours),
    maxHours: numOrNull(u.maxHours),
    exam: { book: 'closed', format: 'calculations', hurdle: null, pastPapers: true, ...(u.exam || {}) },
    assessments: (u.assessments || []).map((a) => ({
      id: a.id || uid(), name: a.name || 'Assessment', type: ASSESSMENT_TYPES.includes(a.type) ? a.type : 'assignment',
      weight: Number(a.weight) || 0, dueWeek: a.dueWeek ?? null, dueDate: a.dueDate || null,
      tbc: !!a.tbc, done: !!a.done, score: numOrNull(a.score), outOf: numOrNull(a.outOf),
    })),
  }));
  out.progress = { ...(s.progress || {}) };
  out.taskEdits = { ...(s.taskEdits || {}) };
  out.checkins = { ...(s.checkins || {}) };
  return out;
}

/** Confidence that applies right now (after any weekly check-ins). */
const currentConfidence = (u) => (state.onboarded ? confidenceFor(u, rawCurrentWeek()) : u.confidence);

function nextColor() {
  const used = new Set(state.units.map((u) => u.color));
  for (let i = 0; i < 10; i++) if (!used.has(i)) return i;
  return state.units.length % 10;
}

function newUnit(code, name) {
  return {
    id: uid(), code, name, confidence: 3, color: nextColor(), confidenceLog: [], topics: {}, readiness: {}, minHours: null, maxHours: null,
    exam: { book: 'closed', format: 'calculations', hurdle: null, pastPapers: true },
    // Exam timetables come out late, so the final exam starts with its date "not announced yet".
    assessments: [{ id: uid(), name: 'Final exam', type: 'exam', weight: 60, dueWeek: null, dueDate: null, tbc: true, done: false, score: null, outOf: null }],
  };
}

const cleanCode = (s) => String(s || '').toUpperCase().replace(/\s+/g, '').slice(0, 12);

function weekLabel(w) {
  const info = weeksInfo()[w - 1];
  if (!info) return `Week ${w}`;
  return `Week ${w} · ${info.label} · ${fmtDate(info.start)}`;
}

function dueText(a) {
  const d = resolveDue(a, state.semester);
  if (d.tentative) return `Week ${d.week} for now (date TBC)`;
  return a.dueDate ? `${fmtDate(a.dueDate, { weekday: 'short', day: 'numeric', month: 'short' })} (Week ${d.week})` : `Week ${d.week}`;
}

/** All assessments still waiting for a real date. */
function tbcAssessments() {
  return state.units.flatMap((u) => u.assessments.filter((a) => a.tbc && !a.done).map((a) => ({ u, a })));
}

// ---------- Week readiness ----------

const READY_LABEL = { 1: 'Not yet', 2: 'Shaky', 3: 'Ready' };
const READY_GLYPH = { 1: '✕', 2: '~', 3: '✓' };
let rdBrush = 3;
let painting = null;

/** Teaching weeks whose content has started (rateable). */
function rateableWeeks() {
  const raw = rawCurrentWeek();
  return weeksInfo().filter((w) => w.type === 'teaching' && w.week <= raw);
}
const currentReadiness = (u, wk) => (u.readiness?.[wk] ? Number(u.readiness[wk].v) : null);
function setReadiness(u, wk, v) {
  u.readiness = { ...(u.readiness || {}) };
  if (!v) delete u.readiness[wk];
  else u.readiness[wk] = { v, at: clamp(rawCurrentWeek(), 1, state.semester.weeks.length) };
}
function readyStrip(u, extraStyle = '') {
  const ws = rateableWeeks();
  if (!ws.length) return '';
  const label = ws.map((w) => `Week ${w.week} ${currentReadiness(u, w.week) ? READY_LABEL[currentReadiness(u, w.week)] : 'not rated'}`).join(', ');
  return `<div class="strip" style="${extraStyle}" role="img" aria-label="${esc(u.code)} readiness: ${label}">${ws.map((w) => {
    const v = currentReadiness(u, w.week);
    return `<i class="${v ? `r${v}` : 'none'}"></i>`;
  }).join('')}</div>`;
}
const unratedCount = () => rateableWeeks().reduce((n, w) => n + state.units.filter((u) => !currentReadiness(u, w.week)).length, 0);

function quickRate(u, wk, cur) {
  return `<div class="rd-quick" data-unit="${u.id}" data-week="${wk}" role="group" aria-label="Week ${wk} readiness">${[1, 2, 3].map((v) =>
    `<button type="button" class="r${v}" data-action="quickRate" data-v="${v}" aria-pressed="${cur === v}">${READY_LABEL[v]}</button>`).join('')}</div>`;
}

function readinessGrid() {
  const ws = rateableWeeks();
  const units = state.units;
  const cols = `minmax(64px, 1fr) repeat(${units.length}, minmax(44px, 72px))`;
  const head = `<span></span>${units.map((u) => `<span class="rd-head" style="${unitColor(u)}">${esc(u.code)}</span>`).join('')}`;
  const rows = ws.map((w) => `<div class="rd-week"><b>W${w.week}</b><span>${fmtDate(w.start)}</span></div>${units.map((u) => {
    const v = currentReadiness(u, w.week);
    const topic = String(u.topics?.[w.week] || '').trim();
    return `<button type="button" class="rd-cell ${v ? `r${v}` : ''}" data-action="rdKey" data-unit="${u.id}" data-week="${w.week}" data-v="${v ?? ''}"
      aria-label="${esc(u.code)} Week ${w.week}${topic ? ` (${esc(topic)})` : ''}: ${v ? READY_LABEL[v] : 'not rated'}">${v ? READY_GLYPH[v] : ''}</button>`;
  }).join('')}`).join('');
  return `<div class="rd-grid" style="grid-template-columns:${cols}">${head}${rows}</div>`;
}

function openReadiness(replace = false) {
  if (!rateableWeeks().length) { toast('You can rate weeks once teaching has started'); return; }
  if (!state.units.length) { toast('Add a unit first'); return; }
  openSheet({
    replace,
    title: 'Week Readiness',
    noSave: true,
    cancelLabel: 'Done',
    onCancel: () => commit(),
    body: `
      <p class="ob-help" style="margin:6px 4px 10px">How ready do you feel for each week's content? Pick a colour, then tap or drag down a column.</p>
      <div class="seg rd-brush" role="group" aria-label="Colour to paint">${[1, 2, 3].map((v) =>
        `<button type="button" data-action="rdBrush" data-v="${v}" aria-pressed="${rdBrush === v}">${READY_GLYPH[v]} ${READY_LABEL[v]}</button>`).join('')}</div>
      ${readinessGrid()}
      <button class="btn secondary" style="margin-top:14px" data-action="rdFillReady" ${unratedCount() ? '' : 'disabled'}>Mark the rest as ready</button>
      <p class="section-footer">Tap a rated week again to clear it. Weeks marked "Not yet" or "Shaky" get extra review time and lead your SWOTVAC revision. Ratings change your plan from this week on.</p>`,
  });
}

function paintCell(cell) {
  const u = unitById(cell.dataset.unit);
  const wk = Number(cell.dataset.week);
  const v = painting.v;
  if (!u || currentReadiness(u, wk) === v) return;
  setReadiness(u, wk, v);
  cell.className = `rd-cell ${v ? `r${v}` : ''}`;
  cell.dataset.v = v ?? '';
  cell.textContent = v ? READY_GLYPH[v] : '';
  cell.setAttribute('aria-label', cell.getAttribute('aria-label').replace(/: [^:]+$/, `: ${v ? READY_LABEL[v] : 'not rated'}`));
  painting.changed = true;
}
function endPaint() {
  if (!painting) return;
  const changed = painting.changed;
  painting = null;
  if (changed) {
    recompute();
    saveState(state).catch(() => {});
    const fill = document.querySelector('.sheet [data-action=rdFillReady]');
    if (fill) fill.disabled = !unratedCount();
  }
}
document.addEventListener('pointerdown', (e) => {
  const cell = e.target.closest('.rd-cell');
  if (!cell) return;
  e.preventDefault();
  const cur = cell.dataset.v ? Number(cell.dataset.v) : null;
  painting = { v: cur === rdBrush ? null : rdBrush, changed: false };
  paintCell(cell);
});
document.addEventListener('pointermove', (e) => {
  if (!painting) return;
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.rd-cell');
  if (el) paintCell(el);
});
document.addEventListener('pointerup', endPaint);
document.addEventListener('pointercancel', endPaint);

function markText(a) {
  const p = markPct(a);
  return p == null ? '' : `${Number(a.score)}/${Number(a.outOf)} (${Math.round(p * 100)}%)`;
}

// ---------- Render ----------

function render() {
  const prevKey = ui.viewKey;
  let html;
  if (!state.onboarded) { html = renderOnboarding(); ui.viewKey = `ob-${state.obStep}-${state.obUnit}`; }
  else if (ui.tab === 'units' && ui.unitId && unitById(ui.unitId)) { html = renderUnitDetail(unitById(ui.unitId)); ui.viewKey = `unit-${ui.unitId}`; }
  else {
    ui.unitId = null;
    html = { week: renderWeek, plan: renderPlan, units: renderUnits, settings: renderSettings }[ui.tab]();
    ui.viewKey = ui.tab;
  }
  const changed = prevKey !== ui.viewKey;
  const y = window.scrollY;
  root.innerHTML = html;
  if (changed) {
    root.querySelector('.screen')?.classList.add('view-enter');
    window.scrollTo(0, 0);
  } else window.scrollTo(0, y);
  root.querySelectorAll('.reorder').forEach(enableReorder);
  syncTabbar(!!root.querySelector('.screen:not(.no-tabs)'));
  onScroll();
}

function shell({ title, body, left = '', right = '', tabs = true, sub = '' }) {
  return `
  <header class="navbar"><div class="nav-left">${left}</div><div class="nav-title">${esc(title)}</div><div class="nav-right">${right}</div></header>
  <main class="screen ${tabs ? '' : 'no-tabs'}">
    <h1 class="large-title">${esc(title)}</h1>
    ${sub ? `<p class="subtitle">${sub}</p>` : ''}
    ${body}
  </main>`;
}

const TABS = [['week', 'This Week'], ['plan', 'Plan'], ['units', 'Units'], ['settings', 'Settings']];

/** The tab bar lives outside the re-rendered view so its glass pill can slide between tabs. */
function syncTabbar(show) {
  let bar = document.getElementById('tabbar');
  if (!bar) {
    bar = document.createElement('nav');
    bar.id = 'tabbar';
    bar.className = 'tabbar glass';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', 'Sections');
    bar.innerHTML = `<span class="tab-pill" aria-hidden="true"></span>${TABS.map(([k, l]) =>
      `<button class="tab" role="tab" data-action="tab" data-tab="${k}">${ICON[k]}<span>${l}</span></button>`).join('')}`;
    document.body.append(bar);
  }
  bar.classList.toggle('hidden', !show);
  document.body.classList.toggle('has-tabs', show);
  const i = Math.max(0, TABS.findIndex(([k]) => k === ui.tab));
  bar.style.setProperty('--i', i);
  bar.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
}

// ---------- This Week ----------

function renderWeek() {
  const n = plan.weeks.length;
  const wk = clamp(ui.week ?? displayWeek(), 1, n);
  const w = plan.weeks[wk - 1];
  const raw = rawCurrentWeek();
  const isNow = raw === wk;
  const planned = w.tasks.reduce((s, t) => s + t.hours, 0);
  const done = w.tasks.reduce((s, t) => s + (t.doneHours || 0), 0);
  const pct = planned ? Math.round((done / planned) * 100) : 0;
  let note = '';
  if (raw < 1) note = `Semester starts ${fmtDate(state.semester.startDate, { weekday: 'long', day: 'numeric', month: 'long' })}.`;
  else if (raw > n) note = 'The semester has finished. Nice work.';

  const today = todayISO();
  const chips = DAY_NAMES.map((name, d) => {
    const date = addDays(w.start, d);
    const off = state.blocked.includes(date);
    const rest = !state.prefs.studyDays[d];
    const what = off ? 'day off' : rest ? 'not a study day' : 'study day';
    return `<button class="day-chip ${off ? 'off' : ''} ${rest ? 'rest' : ''} ${date === today ? 'today' : ''}" data-action="toggleDayOff" data-date="${date}"
      aria-pressed="${off}" aria-label="${name} ${fmtDate(date)}, ${what}" ${rest ? 'disabled' : ''}><span>${name}</span><b>${Number(date.slice(8))}</b></button>`;
  }).join('');

  const days = DAY_NAMES.map((name, d) => {
    const tasks = w.tasks.filter((t) => t.day === d);
    if (!tasks.length) return '';
    const date = addDays(w.start, d);
    const dayHours = tasks.reduce((s, t) => s + t.hours, 0);
    return `
      <div class="section-header"><span>${fmtDate(date, { weekday: 'long', day: 'numeric', month: 'short' })}${date === today ? ' · <span style="color:var(--blue)">Today</span>' : ''}</span><span class="tnum">${fmtH(dayHours)}</span></div>
      <div class="group">${tasks.map(taskRow).join('')}</div>`;
  }).join('');

  const tbc = tbcAssessments();
  const banner = tbc.length ? `
    <div class="section-header" style="color:var(--orange)"><span>Dates to Confirm</span><span>${tbc.length}</span></div>
    <div class="group">${tbc.map(({ u, a }) => `<button class="row tappable" data-action="editAssessment" data-unit="${u.id}" data-id="${a.id}" style="${unitColor(u)};--inset:40px">
      <span class="dot"></span><span class="grow"><div class="title">${esc(u.code)} ${esc(a.name)}</div>
      <div class="sub">Planned for Week ${resolveDue(a, state.semester).week} until you add the real date</div></span>${ICON.chev}</button>`).join('')}</div>` : '';

  const rws = rateableWeeks();
  const unrated = unratedCount();
  const readyCard = rws.length && state.units.length ? `
    <div class="section-header"><span>Week Readiness</span><span>${unrated ? `${unrated} to rate` : 'All rated'}</span></div>
    <button class="group" data-action="openReadiness" style="display:block;width:100%;text-align:left;padding:14px 18px" aria-label="Rate week readiness">
      ${state.units.map((u) => `<div style="display:flex;align-items:center;gap:10px;margin:3px 0;${unitColor(u)}"><span class="dot"></span>
        <span class="small" style="width:72px;flex:none">${esc(u.code)}</span>${readyStrip(u, 'margin:0')}</div>`).join('')}
      <div class="small" style="color:var(--blue);margin-top:10px">${unrated ? 'Rate your weeks: it takes a few seconds' : 'Update ratings'}</div>
    </button>` : '';

  const why = w.allocations.map((a) => {
    const u = unitById(a.unitId);
    return `<details class="row-wrap" data-key="why-${a.unitId}" ${ui.open[`why-${a.unitId}`] ? 'open' : ''}><summary class="row tappable" style="${unitColor(u)}">
        <span class="dot"></span><span class="grow"><span class="title">${esc(a.code)}</span></span>
        <span class="value tnum">${fmtH(a.hours)}</span>${ICON.chev}</summary>
      <div class="details-body"><ul class="reason-list">${a.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div></details>`;
  }).join('');

  const body = `
    <div class="week-switch">
      <button class="round-btn glass interactive" data-action="prevWeek" aria-label="Previous week" ${wk <= 1 ? 'disabled' : ''}>${ICON.left}</button>
      <button class="label" data-action="thisWeek" aria-label="Jump to current week"><b>Week ${wk}${isNow ? ' · Now' : ''}</b><span>${esc(w.label)} · ${fmtDate(w.start)} – ${fmtDate(addDays(w.start, 6))}</span></button>
      <button class="round-btn glass interactive" data-action="nextWeek" aria-label="Next week" ${wk >= n ? 'disabled' : ''}>${ICON.right}</button>
    </div>
    ${note ? `<p class="subtitle" style="margin-top:0">${esc(note)}</p>` : ''}
    <div class="group summary">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div><div class="big">${fmtH(done)} <span class="muted" style="font-size:17px;font-weight:500">of ${fmtH(planned)} done</span></div></div>
        <span class="badge ${pct >= 100 ? 'green' : 'blue'}">${pct}%</span>
      </div>
      <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <div class="stack" aria-hidden="true">${w.allocations.filter((a) => a.hours > 0).map((a) => `<i style="width:${(a.hours / (w.available || 1)) * 100}%;${unitColor(unitById(a.unitId))}"></i>`).join('')}</div>
      <div class="small muted">${fmtH(w.available)} available${w.free > 0 ? ` · ${fmtH(w.free)} free` : ''}${w.carriedIn > 0 ? ` · ${fmtH(w.carriedIn)} carried forward` : ''}</div>
      ${w.notes.map((x) => `<div class="small" style="color:var(--orange)">${esc(x)}</div>`).join('')}
      <div class="day-chips" role="group" aria-label="Days this week. Tap a day to take it off.">${chips}</div>
    </div>
    <p class="section-footer">Tap a day to take it off. Greyed-out days aren't study days (change them in Settings).</p>
    ${banner}
    ${readyCard}
    ${w.tasks.length ? days : `<div class="empty">${w.available ? 'Nothing planned this week.' : 'No study hours this week.'}</div>`}
    <div class="section-header">Why This Split</div>
    <div class="group">${why || '<div class="empty">Add a unit to get a plan.</div>'}</div>
    <p class="section-footer">Tap a task to log progress, see why it's there, or move it.</p>`;
  return shell({ title: 'This Week', body });
}

function taskRow(t) {
  const u = unitById(t.unitId);
  const st = state.progress[t.id]?.status;
  const isDone = isComplete(t);
  const partial = !isDone && t.doneHours > 0;
  const sub = [esc(t.code), partial ? `${fmtH(t.doneHours)} of ${fmtH(t.hours)} done` : fmtH(t.hours)];
  if (t.edited) sub.push(t.pinned ? 'moved' : 'edited');
  return `<div class="row task ${st || ''}" style="${unitColor(u)};--inset:56px">
    <button class="check ${isDone ? 'on' : partial ? 'half' : ''}" data-action="toggleTask" data-id="${t.id}" aria-pressed="${isDone}" aria-label="Done: ${esc(t.title)}"><span>${ICON.check}</span></button>
    <button class="grow" style="text-align:left;min-height:44px" data-action="openTask" data-id="${t.id}">
      <div class="title">${esc(t.title)}</div>
      <div class="sub">${sub.join(' · ')}</div>
    </button>
    ${st === 'missed' ? `<span class="badge orange">${t.doneHours > 0 ? 'Rest moved on' : 'Moved on'}</span>` : ''}
  </div>`;
}

/** A task counts as done when ticked, or when the hours logged cover its (possibly shortened) length. */
const isComplete = (t) => state.progress[t.id]?.status === 'done' || (t.hours > 0 && t.doneHours >= t.hours - 1e-9);

function findTask(id) {
  for (const w of plan.weeks) { const t = w.tasks.find((x) => x.id === id); if (t) return t; }
  return null;
}

function openTaskSheet(id, replace = false) {
  const t = findTask(id);
  if (!t) { closeSheet(); return; }
  const u = unitById(t.unitId);
  const a = t.assessmentId ? u.assessments.find((x) => x.id === t.assessmentId) : null;
  const st = state.progress[id]?.status;
  const w = plan.weeks[t.week - 1];
  const maxHours = t.hours + w.free;
  const days = DAY_NAMES.map((name, d) => `<button type="button" data-action="taskDay" data-id="${id}" data-v="${d}" aria-pressed="${t.day === d}" ${d > t.latestDay ? 'disabled' : ''} aria-label="Move to ${name}">${name}</button>`).join('');
  const done = isComplete(t);
  const missLabel = st === 'missed' ? 'Undo missed' : t.doneHours > 0 ? 'I missed the rest' : 'I missed this';
  openSheet({
    replace,
    title: esc(t.code),
    noSave: true,
    cancelLabel: 'Done',
    body: `
      <div class="ob-q" style="font-size:22px;line-height:28px;margin-top:4px">${esc(t.title)}</div>
      <p class="ob-help" style="margin-bottom:12px">${fmtDate(addDays(w.start, t.day), { weekday: 'long', day: 'numeric', month: 'short' })} · ${fmtH(t.hours)}</p>
      <div class="section-header">Why</div>
      <div class="group" style="padding:12px 16px"><ul class="reason-list" style="padding-left:16px"><li>${esc(t.reason)}</li>
        ${a ? `<li>For ${esc(a.name)} (${a.weight}%), due ${esc(dueText(a))}.</li>` : ''}</ul></div>

      ${t.reviewWeek ? `<div class="section-header">How Ready Is Week ${t.reviewWeek} Now?</div>
      <div class="group" style="padding:12px">${quickRate(u, t.reviewWeek, currentReadiness(u, t.reviewWeek))}</div>` : ''}

      <div class="section-header">Progress</div>
      <div class="group">
        <div class="row"><span class="grow">Hours done</span>
          <span class="tnum" style="font-weight:600">${fmtH(t.doneHours)} of ${fmtH(t.hours)}</span>
          <span class="stepper"><button data-action="taskDone" data-id="${id}" data-d="-0.5" aria-label="Half an hour less done">−</button><button data-action="taskDone" data-id="${id}" data-d="0.5" aria-label="Half an hour more done">+</button></span></div>
      </div>
      <div style="display:grid;gap:10px;margin-top:12px">
        <button class="btn" data-action="setTask" data-id="${id}" data-v="${done ? 'undone' : 'done'}">${done ? 'Mark as not done' : 'Mark as done'}</button>
        ${done ? '' : `<button class="btn ${st === 'missed' ? 'secondary' : 'danger'}" data-action="setTask" data-id="${id}" data-v="${st === 'missed' ? 'unmiss' : 'missed'}">${missLabel}</button>`}
      </div>
      <p class="section-footer">Only the hours you didn't do move to later weeks. Anything unfinished when the week ends moves too.</p>

      <div class="section-header">Change</div>
      <div class="group">
        <div class="row"><div class="seg" role="group" aria-label="Day">${days}</div></div>
        <div class="row"><span class="grow">Length</span>
          <span class="tnum" style="font-weight:600">${fmtH(t.hours)}</span>
          <span class="stepper"><button data-action="taskHours" data-id="${id}" data-d="-0.5" aria-label="Shorter" ${t.hours <= 0.5 ? 'disabled' : ''}>−</button><button data-action="taskHours" data-id="${id}" data-d="0.5" aria-label="Longer" ${t.hours + 0.5 > maxHours + 1e-9 ? 'disabled' : ''}>+</button></span></div>
        ${t.edited ? `<button class="row action" data-action="taskReset" data-id="${id}">Reset to the plan</button>` : ''}
      </div>
      <p class="section-footer">${t.latestDay < 6 && a ? `Must be done by ${DAY_NAMES[t.latestDay]}, when ${esc(a.name)} is due. ` : ''}A moved task stays on its day and the rest of the week is planned around it. Shortening a task doesn't move hours elsewhere. A task can only grow into this week's free time (${w.free > 0 ? fmtH(w.free) : 'none left'}).</p>`,
  });
}

// ---------- Plan ----------

function renderPlan() {
  const raw = rawCurrentWeek();
  const legend = state.units.map((u) => `<span style="${unitColor(u)}"><i class="dot"></i>${esc(u.code)}</span>`).join('');
  const markersFor = (wk) => state.units.flatMap((u) => u.assessments
    .filter((a) => resolveDue(a, state.semester).week === wk)
    .map((a) => {
      const cls = a.tbc && !a.done ? 'tbc' : a.done ? 'done' : '';
      const tag = a.tbc && !a.done ? ' · TBC' : a.done ? ` · ✓${markPct(a) != null ? ` ${Math.round(markPct(a) * 100)}%` : ''}` : '';
      return `<span class="marker ${cls}" style="${unitColor(u)}">${ICON.diamond}${esc(u.code)} ${esc(a.name)} · ${a.weight}%${tag}</span>`;
    })).join('');
  const cards = plan.weeks.map((w) => {
    const done = w.tasks.reduce((s, t) => s + (t.doneHours || 0), 0);
    const cls = [`type-${w.type}`, w.week === raw ? 'current' : '', w.week < raw ? 'past' : ''].join(' ');
    const markers = markersFor(w.week);
    return `<button class="week-card ${cls}" data-action="gotoWeek" data-week="${w.week}" aria-label="Open week ${w.week}">
      <div class="top"><b>Week ${w.week}</b><span class="muted small grow ellipsis">${esc(w.label)} · ${fmtDate(w.start)}</span>
        ${w.week === raw ? '<span class="badge blue">Now</span>' : ''}
        <span class="small muted tnum">${done > 0 ? `${fmtH(done)} / ` : ''}${fmtH(w.allocated)}</span></div>
      <div class="stack">${w.allocations.filter((a) => a.hours > 0).map((a) => `<i style="width:${(a.hours / (w.available || 1)) * 100}%;${unitColor(unitById(a.unitId))}" title="${esc(a.code)} ${fmtH(a.hours)}"></i>`).join('')}</div>
      ${markers ? `<div class="markers">${markers}</div>` : ''}
    </button>`;
  }).join('');
  const unsched = plan.unscheduled.length ? `
    <div class="group" style="padding:12px 16px;margin-bottom:12px"><b style="color:var(--orange)">Not enough time</b>
      <ul class="reason-list">${plan.unscheduled.flatMap((u) => u.reasons).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="small muted" style="margin:6px 0 0">Add hours to some weeks in Settings to fit it in.</p></div>` : '';
  const total = plan.weeks.reduce((s, w) => s + w.allocated, 0);
  return shell({
    title: 'Plan',
    sub: `${plan.weeks.length} weeks · ${fmtH(total)} planned`,
    body: `<div class="legend">${legend}${tbcAssessments().length ? '<span><i class="marker tbc" style="--uc:var(--orange);padding:0 8px;font-style:normal">TBC</i>date not announced</span>' : ''}</div>${unsched}<div class="timeline">${cards}</div>`,
  });
}

// ---------- Units ----------

function renderUnits() {
  const rows = state.units.map((u) => {
    const s = plan.unitSummaries.find((x) => x.unitId === u.id);
    return `<button class="row tappable" data-action="openUnit" data-id="${u.id}" style="${unitColor(u)};--inset:40px">
      <span class="dot"></span>
      <span class="grow"><div class="title">${esc(u.code)}</div><div class="sub ellipsis">${esc(u.name || 'No name')} · ${u.assessments.length} assessment${u.assessments.length === 1 ? '' : 's'}</div>${readyStrip(u)}</span>
      <span class="value tnum">${s?.share ?? 0}% · ${fmtH(s?.total ?? 0)}</span>${ICON.chev}</button>`;
  }).join('');
  return shell({
    title: 'Units',
    body: `
      <div class="group">${rows || '<div class="empty">No units yet.</div>'}
        <button class="row action" data-action="addUnitSheet">${ICON.plus}<span>Add unit</span></button></div>
      <p class="section-footer">Listed hardest to easiest. Change the order in Settings.</p>`,
  });
}

function renderUnitDetail(u) {
  const s = plan.unitSummaries.find((x) => x.unitId === u.id);
  const rank = state.units.indexOf(u);
  const wk = displayWeek();
  const weeks = weeksInfo();
  const sc = scoreUnit(u, rank, state.units.length, weeks[wk - 1], state.semester);
  const labels = { base: 'Base', difficulty: 'Difficulty rank', confidence: 'Confidence gap', weight: 'Assessment weight', urgency: 'Urgency', hurdle: 'Hurdle', results: 'Your marks', readiness: 'Week readiness' };
  const maxPart = Math.max(1, ...Object.values(sc.breakdown).map(Math.abs));
  const bars = Object.entries(sc.breakdown).map(([k, v]) => `
    <div class="bar-row"><span>${labels[k] || k}</span><span class="track"><i class="${v < 0 ? 'neg' : ''}" style="width:${(Math.abs(v) / maxPart) * 100}%"></i></span><span class="num">${v > 0 && k === 'results' ? '+' : ''}${v.toFixed(1)}</span></div>`).join('');
  const alloc = plan.weeks[wk - 1].allocations.find((a) => a.unitId === u.id);
  const maxH = Math.max(1, ...s.perWeek.map((p) => p.hours));
  const spark = s.perWeek.map((p) => `<i class="${p.week === rawCurrentWeek() ? 'now' : ''}" style="height:${(p.hours / maxH) * 100}%" title="Week ${p.week}: ${fmtH(p.hours)}"></i>`).join('');
  const axis = s.perWeek.map((p) => `<span>${p.week % 2 ? p.week : ''}</span>`).join('');
  const teachingWeeks = weeks.filter((w) => w.type === 'teaching');
  const topicCount = teachingWeeks.filter((w) => String(u.topics?.[w.week] || '').trim()).length;
  const topics = teachingWeeks.map((w) => `
    <label class="row"><span class="rank-num" style="width:34px;text-align:left">W${w.week}</span>
      <input class="field-input" data-change="topic" data-unit="${u.id}" data-week="${w.week}" value="${esc(u.topics?.[w.week] || '')}" placeholder="${esc(w.label)} topic" aria-label="Topic for week ${w.week}"></label>`).join('');

  const body = `
    <div class="section-header">Why It Gets This Time</div>
    <div class="group" style="padding:12px 16px"><ul class="reason-list" style="padding-left:16px">${s.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>

    <div class="section-header"><span>Hours per Week</span><span>peak ${fmtH(maxH)}</span></div>
    <div class="group" style="${unitColor(u)}"><div class="spark" aria-label="Hours per week chart">${spark}</div><div class="spark-axis" aria-hidden="true">${axis}</div></div>

    <div class="section-header"><span>Priority Score · Week ${wk}</span><span class="tnum">${sc.score.toFixed(1)} pts</span></div>
    <div class="group" style="${unitColor(u)}"><div class="bars">${bars}</div>
      ${alloc ? `<div style="padding:0 16px 14px"><ul class="reason-list" style="padding-left:16px">${alloc.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}</div>
    <p class="section-footer">Each week's hours are split in proportion to these scores, after a small baseline per unit. No unit takes more than half a week unless something is due that week.</p>

    ${rateableWeeks().length ? `<div class="section-header">Week Readiness</div>
    <button class="group" data-action="openReadiness" style="display:block;width:100%;text-align:left;padding:14px 18px;${unitColor(u)}">
      ${readyStrip(u, 'margin:0')}
      <div class="small muted" style="margin-top:8px">${(() => {
        const rs = rateableWeeks().map((w) => currentReadiness(u, w.week));
        const n = (v) => rs.filter((x) => x === v).length;
        return `${n(3)} ready · ${n(2)} shaky · ${n(1)} not yet · ${n(null)} not rated`;
      })()}</div>
      <div class="small" style="color:var(--blue);margin-top:8px">Rate weeks</div>
    </button>` : ''}

    ${unitFields(u)}

    <div class="section-header">Hours Limits</div>
    <div class="group">
      <label class="row"><span class="grow">At least</span><input class="value tnum" style="max-width:110px" type="number" inputmode="decimal" min="0" max="80" step="0.5" data-change="minHours" data-unit="${u.id}" value="${u.minHours ?? ''}" placeholder="No minimum" aria-label="Minimum hours per week">h/wk</label>
      <label class="row"><span class="grow">At most</span><input class="value tnum" style="max-width:110px" type="number" inputmode="decimal" min="0" max="80" step="0.5" data-change="maxHours" data-unit="${u.id}" value="${u.maxHours ?? ''}" placeholder="No limit" aria-label="Maximum hours per week">h/wk</label>
    </div>
    <p class="section-footer">Optional. Leave blank to let the planner decide. A minimum applies to every week the unit is still running.</p>

    <div class="section-header">Weekly Topics</div>
    <div class="group">
      <details class="row-wrap" data-key="topics-${u.id}" ${ui.open[`topics-${u.id}`] ? 'open' : ''}>
        <summary class="row tappable"><span class="grow">Lecture topics${topicCount ? ` · ${topicCount} added` : ''}</span><span class="value">Optional</span>${ICON.chev}</summary>
        <div>${topics}</div>
      </details>
    </div>
    <p class="section-footer">Name each week's topic and tasks will say "Learn: Laplace transforms" or "Review: Laplace transforms" instead of a week number.</p>

    <div class="section-header">Unit</div>
    <div class="group">
      <label class="row"><span>Code</span><input class="value" data-change="unitCode" data-unit="${u.id}" value="${esc(u.code)}" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="Unit code"></label>
      <label class="row"><span>Name</span><input class="value" data-change="unitName" data-unit="${u.id}" value="${esc(u.name)}" placeholder="Optional" aria-label="Unit name"></label>
    </div>
    <div class="group" style="margin-top:20px"><button class="row destructive" data-action="deleteUnit" data-unit="${u.id}">Delete unit</button></div>`;
  return shell({
    title: u.code,
    sub: esc(u.name || ''),
    left: `<button class="nav-btn glass interactive circle" data-action="back" aria-label="Back to Units">${ICON.back}</button>`,
    body,
  });
}

/** Confidence, assessments and exam context for one unit (shared by onboarding and unit detail). */
function unitFields(u) {
  const total = u.assessments.reduce((s, a) => s + (Number(a.weight) || 0), 0);
  const assess = u.assessments
    .map((a) => ({ a, d: resolveDue(a, state.semester) }))
    .sort((x, y) => x.d.week - y.d.week || x.d.day - y.d.day)
    .map(({ a }) => {
      const badges = [
        a.done ? `<span class="badge green">✓ Done${markPct(a) != null ? ` ${Math.round(markPct(a) * 100)}%` : ''}</span>` : '',
        a.tbc && !a.done ? '<span class="badge orange">TBC</span>' : '',
        isHurdled(a, u) ? '<span class="badge">Hurdle</span>' : '',
      ].join(' ');
      return `<button class="row tappable" data-action="editAssessment" data-unit="${u.id}" data-id="${a.id}">
      <span class="grow"><div class="title">${esc(a.name)} ${badges}</div>
      <div class="sub">${cap(a.type)} · ${a.weight}% · ${esc(dueText(a))}</div></span>${ICON.chev}</button>`;
    }).join('');
  const confLabels = ['Lost', 'Shaky', 'Okay', 'Good', 'Solid'];
  const conf = currentConfidence(u);
  const ex = u.exam;
  return `
    <div class="section-header">Confidence Right Now</div>
    <div class="group" style="padding:10px 12px">
      <div class="seg" role="group" aria-label="Confidence 1 to 5">${[1, 2, 3, 4, 5].map((v) =>
        `<button data-action="setConfidence" data-unit="${u.id}" data-v="${v}" aria-pressed="${conf === v}">${v}</button>`).join('')}</div>
      <div class="small muted" style="text-align:center;margin-top:6px">${conf}/5 · ${confLabels[conf - 1]}</div>
    </div>
    ${state.onboarded ? '<p class="section-footer">Changes your plan from this week on. Earlier weeks keep what you said then.</p>' : ''}

    <div class="section-header"><span>Assessments</span><span style="${total === 100 ? '' : 'color:var(--orange)'}">${total}% total</span></div>
    <div class="group">${assess}
      <button class="row action" data-action="addAssessment" data-unit="${u.id}">${ICON.plus}<span>Add assessment</span></button></div>
    <p class="section-footer">${total !== 100 ? 'Weights usually add up to 100%. ' : ''}Don't know a date yet? Mark it "Date not known yet" and it's planned for Week ${tentativeWeekOf(state.semester)} for now.</p>

    <div class="section-header">Exam</div>
    <div class="group">
      <div class="row"><div class="seg" role="group" aria-label="Exam book type">
        <button data-action="setBook" data-unit="${u.id}" data-v="closed" aria-pressed="${ex.book !== 'open'}">Closed book</button>
        <button data-action="setBook" data-unit="${u.id}" data-v="open" aria-pressed="${ex.book === 'open'}">Open book</button></div></div>
      <label class="row"><span>Format</span><select class="value" data-change="examFormat" data-unit="${u.id}" aria-label="Exam format">
        ${Object.entries(FORMATS).map(([k, l]) => `<option value="${k}" ${ex.format === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="row"><span class="grow">Hurdle requirement</span><input type="checkbox" class="switch" data-change="hurdleOn" data-unit="${u.id}" ${ex.hurdle ? 'checked' : ''} aria-label="Hurdle requirement"></label>
      ${ex.hurdle ? `<label class="row"><span class="grow">Must score on exam</span><input class="value tnum" style="max-width:70px" type="number" inputmode="numeric" min="1" max="100" data-change="hurdlePct" data-unit="${u.id}" value="${ex.hurdle}" aria-label="Hurdle percent">%</label>` : ''}
      <label class="row"><span class="grow">Past papers available</span><input type="checkbox" class="switch" data-change="pastPapers" data-unit="${u.id}" ${ex.pastPapers !== false ? 'checked' : ''} aria-label="Past papers available"></label>
    </div>`;
}

function weekOptions(selected) {
  return weeksInfo().map((w) => `<option value="${w.week}" ${w.week === selected ? 'selected' : ''}>${esc(weekLabel(w.week))}</option>`).join('');
}

function assessmentSheet(unitId, id) {
  const u = unitById(unitId);
  const existing = id ? u.assessments.find((a) => a.id === id) : null;
  const a = existing || { name: '', type: 'assignment', weight: 20, dueWeek: Math.min(6, state.semester.weeks.length), dueDate: null, tbc: false, done: false };
  const byDate = !!a.dueDate;
  const due = resolveDue({ ...a, tbc: false }, state.semester);
  const tw = tentativeWeekOf(state.semester);
  openSheet({
    title: existing ? 'Edit assessment' : 'New assessment',
    saveLabel: existing ? 'Save' : 'Add',
    body: `
      <div class="group" style="margin-top:8px">
        <label class="row"><span>Name</span><input class="value" name="name" value="${esc(a.name)}" placeholder="e.g. Assignment 1" aria-label="Assessment name"></label>
        <label class="row"><span>Type</span><select class="value" name="type" aria-label="Type">${ASSESSMENT_TYPES.map((t) => `<option value="${t}" ${a.type === t ? 'selected' : ''}>${cap(t)}</option>`).join('')}</select></label>
        <label class="row"><span class="grow">Weight</span><input class="value tnum" style="max-width:80px" type="number" inputmode="decimal" min="0" max="100" name="weight" value="${a.weight}" aria-label="Weight percent">%</label>
      </div>
      <div class="section-header">Due</div>
      <div class="group">
        <label class="row"><span class="grow">Date not known yet</span><input type="checkbox" class="switch" name="tbc" data-action="tbcToggle" ${a.tbc ? 'checked' : ''} aria-label="Date not known yet"></label>
        <div class="row due-mode ${a.tbc ? 'hidden' : ''}"><div class="seg" role="group" aria-label="Due by">
          <button type="button" data-action="dueMode" data-v="week" aria-pressed="${!byDate}">By week</button>
          <button type="button" data-action="dueMode" data-v="date" aria-pressed="${byDate}">By date</button></div></div>
        <label class="row due-week ${byDate || a.tbc ? 'hidden' : ''}"><span>Week</span><select class="value" name="dueWeek" aria-label="Due week">${weekOptions(due.week)}</select></label>
        <label class="row due-date ${byDate && !a.tbc ? '' : 'hidden'}"><span class="grow">Date</span><input type="date" name="dueDate" value="${esc(a.dueDate || addDays(weeksInfo()[clamp(due.week, 1, state.semester.weeks.length) - 1].start, 4))}" aria-label="Due date"></label>
      </div>
      <p class="section-footer due-help">${a.tbc ? `Planned for Week ${tw} for now. You'll see it under "Dates to confirm" until you add the real date.` : 'If you only know the week, Friday is assumed.'}</p>

      <div class="section-header">Result</div>
      <div class="group">
        <label class="row"><span class="grow">Finished</span><input type="checkbox" class="switch" name="done" data-action="doneToggle" ${a.done ? 'checked' : ''} aria-label="Finished"></label>
        <div class="row score-row ${a.done ? '' : 'hidden'}"><span class="grow">Mark</span>
          <input class="value tnum" style="max-width:64px" type="number" inputmode="decimal" min="0" name="score" value="${a.score ?? ''}" placeholder="—" aria-label="Score">
          <span class="muted">out of</span>
          <input class="value tnum" style="max-width:64px" type="number" inputmode="decimal" min="0" name="outOf" value="${a.outOf ?? ''}" placeholder="100" aria-label="Out of"></div>
      </div>
      <p class="section-footer">Finished assessments get no more study time. A mark is optional: low marks give the unit extra time afterwards.</p>
      ${existing ? `<div class="group" style="margin-top:20px"><button class="row destructive" data-action="deleteAssessment" data-unit="${unitId}" data-id="${id}">Delete assessment</button></div>` : ''}`,
    onSave: (sheet) => {
      const f = (n) => sheet.querySelector(`[name="${n}"]`);
      const name = f('name').value.trim();
      if (!name) { toast('Give the assessment a name'); return false; }
      const weight = clamp(Number(f('weight').value) || 0, 0, 100);
      const tbc = f('tbc').checked;
      const dateMode = !tbc && sheet.querySelector('[data-action="dueMode"][data-v="date"]').getAttribute('aria-pressed') === 'true';
      const done = f('done').checked;
      const score = done ? numOrNull(f('score').value) : null;
      const outOf = done && score != null ? numOrNull(f('outOf').value) ?? 100 : null;
      if (score != null && (score < 0 || outOf <= 0 || score > outOf)) { toast('Check the mark: it should be between 0 and the total'); return false; }
      const rec = { id: existing?.id || uid(), name, type: f('type').value, weight, tbc,
        dueWeek: tbc || dateMode ? (tbc ? existing?.dueWeek ?? null : null) : Number(f('dueWeek').value),
        dueDate: dateMode ? f('dueDate').value || null : null, done, score, outOf };
      if (dateMode && !rec.dueDate) { toast('Pick a due date'); return false; }
      const wasTbc = !!existing?.tbc;
      if (existing) Object.assign(existing, rec); else u.assessments.push(rec);
      commit();
      if (wasTbc && !tbc) toast('Date confirmed. Plan updated');
    },
  });
}

function addUnitSheet() {
  openSheet({
    title: 'Add unit',
    saveLabel: 'Add',
    body: `<div class="group" style="margin-top:8px">
        <label class="row"><span>Code</span><input class="value" name="code" placeholder="ENG2005" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="Unit code"></label>
        <label class="row"><span>Name</span><input class="value" name="name" placeholder="Optional" aria-label="Unit name"></label></div>
      <p class="section-footer">New units are added as the easiest. Re-rank them in Settings.</p>`,
    onSave: (sheet) => {
      const u = tryAddUnit(sheet.querySelector('[name=code]').value, sheet.querySelector('[name=name]').value);
      if (!u) return false;
      commit();
    },
  });
}

function tryAddUnit(codeRaw, nameRaw) {
  const code = cleanCode(codeRaw);
  if (!code) { toast('Enter a unit code'); return null; }
  if (state.units.some((u) => u.code === code)) { toast(`${code} is already added`); return null; }
  const u = newUnit(code, String(nameRaw || '').trim());
  state.units.push(u);
  return u;
}

// ---------- Settings ----------

function weekGrid(mode) {
  return `<div class="week-grid">${weeksInfo().map((w) => {
    const o = state.hours.overrides[w.week];
    const busy = mode === 'hours' && o != null && o !== '';
    const sub = mode === 'hours' ? (busy ? fmtH(Number(o)) : fmtH(Number(state.hours.perWeek))) : TYPE_SHORT[w.type];
    return `<button class="wk t-${w.type} ${busy ? 'busy' : ''}" data-action="${mode === 'hours' ? 'editWeekHours' : 'cycleWeekType'}" data-week="${w.week}" aria-label="Week ${w.week}, ${esc(w.label)}, ${sub}">
      <b>W${w.week}</b><span>${sub}</span></button>`;
  }).join('')}</div>`;
}

function semesterFields() {
  return `
    <div class="group">
      <label class="row"><span class="grow">Start date</span><input type="date" data-change="startDate" value="${esc(state.semester.startDate)}" aria-label="Semester start date"></label>
    </div>
    <p class="section-footer">Weeks run Monday to Sunday. Tap a week to change it: Teaching → Break → SWOTVAC → Exams.</p>
    <div style="margin-top:12px">${weekGrid('type')}</div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn secondary" data-action="removeWeek" ${state.semester.weeks.length <= 1 ? 'disabled' : ''}>− Week</button>
      <button class="btn secondary" data-action="addWeek">+ Week</button>
      <button class="btn secondary" data-action="resetWeeks">Default</button>
    </div>`;
}

function hoursFields() {
  return `
    <div class="group">
      <div class="row"><span class="grow">Hours per week</span>
        <span class="tnum" style="min-width:44px;text-align:right;font-weight:600">${fmtH(Number(state.hours.perWeek))}</span>
        <span class="stepper"><button data-action="hoursStep" data-d="-1" aria-label="One hour less">−</button><button data-action="hoursStep" data-d="1" aria-label="One hour more">+</button></span></div>
    </div>
    <div class="section-header">Busy Weeks</div>
    ${weekGrid('hours')}
    <p class="section-footer">Tap a week to give it fewer (or more) hours. Busy weeks have an orange outline.</p>`;
}

function rankList() {
  return `<div class="group reorder" data-reorder="units">${state.units.map((u, i) => `
    <div class="row" data-id="${u.id}" style="${unitColor(u)};--inset:52px">
      <span class="rank-num">${i + 1}</span><span class="dot"></span>
      <span class="grow"><div class="title">${esc(u.code)}</div>${u.name ? `<div class="sub ellipsis">${esc(u.name)}</div>` : ''}</span>
      <span class="handle" aria-label="Drag to reorder ${esc(u.code)}">${ICON.handle}</span></div>`).join('')}</div>`;
}

function studyFields() {
  const p = state.prefs;
  const chips = DAY_NAMES.map((name, d) => `<button class="day-chip ${p.studyDays[d] ? 'on' : 'rest'}" data-action="toggleStudyDay" data-d="${d}" aria-pressed="${p.studyDays[d]}" aria-label="${name}: ${p.studyDays[d] ? 'study day' : 'not a study day'}"><span>${name}</span></button>`).join('');
  const sessions = SESSION_CHOICES.map((h) => `<button data-action="setSession" data-v="${h}" aria-pressed="${p.sessionLength === h}">${fmtSession(h)}</button>`).join('');
  return `
    <div class="group summary" style="padding:12px">
      <div class="day-chips" role="group" aria-label="Study days">${chips}</div>
    </div>
    <p class="section-footer">Tasks are only planned on the highlighted days.</p>
    <div class="group" style="margin-top:12px">
      <div class="row"><span class="grow">Max per day</span>
        <span class="tnum" style="font-weight:600">${p.dailyMax ? fmtH(p.dailyMax) : 'No limit'}</span>
        <span class="stepper"><button data-action="dailyStep" data-d="-1" aria-label="Lower daily limit" ${p.dailyMax ? '' : 'disabled'}>−</button><button data-action="dailyStep" data-d="1" aria-label="Raise daily limit">+</button></span></div>
      <div class="row" style="flex-wrap:wrap;gap:8px"><span>Session length</span><div class="seg" role="group" aria-label="Session length">${sessions}</div></div>
    </div>
    <p class="section-footer">If your days can't hold all your weekly hours, the week is planned with fewer hours and the app tells you why.</p>`;
}

function daysOffFields() {
  const today = todayISO();
  const list = state.blocked.filter((d) => d >= addDays(today, -7));
  const rows = list.map((d) => {
    const wk = weekForDate(state.semester, d);
    return `<div class="row"><span class="grow"><div class="title">${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      <div class="sub">${wk >= 1 && wk <= state.semester.weeks.length ? `Week ${wk}` : 'Outside the semester'}</div></span>
      <button class="nav-btn" style="color:var(--red)" data-action="removeDayOff" data-date="${d}" aria-label="Remove day off ${d}">Remove</button></div>`;
  }).join('');
  return `<div class="group">${rows}
      <button class="row action" data-action="addDayOffSheet">${ICON.plus}<span>Add a day off</span></button></div>
    <p class="section-footer">Birthdays, shifts, travel. You can also tap a day on This Week. Without a daily limit, that day's work moves to your other days. With one, any extra moves to the next week.</p>`;
}

function renderSettings() {
  const tw = tentativeWeekOf(state.semester);
  const body = `
    <div class="section-header">Semester</div>
    ${semesterFields()}
    <div class="group" style="margin-top:12px">
      <label class="row"><span class="grow">Unknown dates go in</span><select class="value" data-change="tentativeWeek" aria-label="Week for assessments without a date">${weekOptions(tw)}</select></label>
    </div>
    <p class="section-footer">Assessments marked "Date not known yet" are planned for this week until you add the real date. Default: Week ${DEFAULT_TENTATIVE_WEEK}.</p>
    <div class="section-header">Study Hours</div>
    ${hoursFields()}
    <div class="section-header">Study Days</div>
    ${studyFields()}
    <div class="section-header">Days Off</div>
    ${daysOffFields()}
    <div class="section-header">Hardest to Easiest</div>
    ${state.units.length ? rankList() : '<div class="group"><div class="empty">No units yet.</div></div>'}
    <p class="section-footer">Drag the handle to re-rank. Harder units get more time.</p>
    <div class="section-header">Weekly Check-in</div>
    <div class="group">
      <label class="row"><span class="grow">Ask how I'm going each week</span><input type="checkbox" class="switch" data-change="checkinOn" ${state.prefs.checkin !== false ? 'checked' : ''} aria-label="Weekly check-in"></label>
      <button class="row action" data-action="openCheckin">Check in now</button>
    </div>
    <p class="section-footer">On the first open of each week, rate your confidence in each unit. The plan adjusts from that week on.</p>
    <div class="section-header">Backup</div>
    <div class="group">
      <button class="row action" data-action="exportData">Export backup (JSON)</button>
      <button class="row action" data-action="importData">Import backup…</button>
    </div>
    <input type="file" id="import-file" accept="application/json,.json" class="hidden">
    <p class="section-footer">Your data is stored only on this device${state.persisted ? ' (protected from automatic clean-up)' : ''}. Export a backup now and then.</p>
    <div class="group" style="margin-top:24px"><button class="row destructive" data-action="resetAll">Reset all data</button></div>
    <p class="section-footer" style="text-align:center;margin-top:24px">Study Planner · works offline · no accounts, no tracking</p>`;
  return shell({ title: 'Settings', body });
}

function addDayOffSheet() {
  const today = todayISO();
  openSheet({
    title: 'Day off',
    saveLabel: 'Add',
    body: `<div class="group" style="margin-top:8px">
        <label class="row"><span class="grow">Date</span><input type="date" name="d" value="${today}" aria-label="Day off date"></label></div>
      <p class="section-footer">Nothing will be planned on this day.</p>`,
    onSave: (sheet) => {
      const d = sheet.querySelector('[name=d]').value;
      if (!d) { toast('Pick a date'); return false; }
      if (!state.blocked.includes(d)) state.blocked = [...state.blocked, d].sort();
      commit();
    },
  });
}

// ---------- Weekly check-in ----------

function needsCheckin() {
  if (!state.onboarded || state.prefs.checkin === false || !state.units.length) return false;
  const wk = rawCurrentWeek();
  return wk >= 1 && wk <= state.semester.weeks.length && wk > (state.trackFrom ?? 1) && !state.checkins[wk];
}

function openCheckin() {
  const wk = clamp(rawCurrentWeek(), 1, state.semester.weeks.length);
  const confLabels = ['Lost', 'Shaky', 'Okay', 'Good', 'Solid'];
  const lastWeek = [...weeksInfo()].reverse().find((w) => w.type === 'teaching' && w.week < wk) || null;
  const rows = state.units.map((u) => {
    const c = currentConfidence(u);
    return `<div class="group checkin" data-unit="${u.id}" style="padding:12px;margin-bottom:10px;${unitColor(u)}">
      <div style="display:flex;align-items:center;gap:8px;margin:0 4px 8px"><span class="dot"></span><b>${esc(u.code)}</b><span class="small muted ci-label" style="margin-left:auto">${c}/5 · ${confLabels[c - 1]}</span></div>
      <div class="seg" role="group" aria-label="${esc(u.code)} confidence">${[1, 2, 3, 4, 5].map((v) =>
        `<button type="button" data-action="checkinPick" data-v="${v}" aria-pressed="${c === v}">${v}</button>`).join('')}</div>
      ${lastWeek ? `<div class="small muted" style="margin:12px 4px 6px">Week ${lastWeek.week} content${String(u.topics?.[lastWeek.week] || '').trim() ? `: ${esc(u.topics[lastWeek.week])}` : ''}</div>
      ${quickRate(u, lastWeek.week, currentReadiness(u, lastWeek.week))}` : ''}</div>`;
  }).join('');
  openSheet({
    title: `Week ${wk} check-in`,
    cancelLabel: 'Skip',
    body: `<p class="ob-help" style="margin-top:8px">How confident do you feel in each unit right now${lastWeek ? `, and how ready is Week ${lastWeek.week}'s content` : ''}? Your plan adjusts from this week on.</p>${rows}`,
    onSave: (sheet) => {
      for (const g of sheet.querySelectorAll('.checkin')) {
        const u = unitById(g.dataset.unit);
        const v = Number(g.querySelector('[aria-pressed=true]')?.dataset.v);
        if (u && v) logConfidence(u, v, wk);
        const q = g.querySelector('.rd-quick');
        const rv = Number(q?.querySelector('[aria-pressed=true]')?.dataset.v);
        if (u && q && rv) setReadiness(u, Number(q.dataset.week), rv);
      }
      state.checkins[wk] = 'done';
      commit();
      toast('Thanks! Plan updated');
    },
    onCancel: () => { state.checkins[wk] = 'skipped'; saveState(state).catch(() => {}); },
  });
}

/** Record confidence for a week (after onboarding) so earlier weeks keep their old value. */
function logConfidence(u, v, wk = clamp(rawCurrentWeek(), 1, state.semester.weeks.length)) {
  u.confidenceLog = (u.confidenceLog || []).filter((e) => e.week !== wk);
  u.confidenceLog.push({ week: wk, value: v });
  u.confidenceLog.sort((a, b) => a.week - b.week);
}

function editWeekHoursSheet(week) {
  const o = state.hours.overrides[week];
  let val = o != null && o !== '' ? Number(o) : Number(state.hours.perWeek);
  openSheet({
    title: `Week ${week} hours`,
    body: `<p class="ob-help" style="margin-top:8px">${esc(weekLabel(week))}</p>
      <input class="input-big tnum" type="number" inputmode="decimal" min="0" max="100" step="0.5" name="h" value="${val}" aria-label="Hours for week ${week}">
      <p class="section-footer" style="text-align:center">hours available this week</p>
      <button class="btn secondary" style="margin-top:20px" data-action="clearWeekHours" data-week="${week}">Normal week (${fmtH(Number(state.hours.perWeek))})</button>`,
    onSave: (sheet) => {
      const h = Number(sheet.querySelector('[name=h]').value);
      if (!Number.isFinite(h) || h < 0) { toast('Enter a number of hours'); return false; }
      if (h === Number(state.hours.perWeek)) delete state.hours.overrides[week]; else state.hours.overrides[week] = h;
      commit();
    },
  });
}

async function exportData() {
  const name = `study-planner-backup-${todayISO()}.json`;
  const text = JSON.stringify(state, null, 2);
  const file = new File([text], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Study Planner backup' }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup exported');
}

function importFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object' || !data.semester || !Array.isArray(data.units)) throw new Error('bad');
      if (!confirm(`Replace your current data with this backup (${data.units.length} units)?`)) return;
      state = normalize(data);
      state.onboarded = true;
      ui.week = null; ui.unitId = null;
      commit();
      toast('Backup imported');
    } catch { toast('That file is not a Study Planner backup'); }
  };
  reader.readAsText(file);
}

// ---------- Onboarding ----------

const OB_LAST = 6;

function obProgress() {
  const n = Math.max(1, state.units.length);
  const total = 5 + n;
  const pos = state.obStep < 5 ? state.obStep : state.obStep === 5 ? 5 + state.obUnit : total;
  return pos / total;
}

function renderOnboarding() {
  const step = state.obStep;
  let body = '', next = 'Continue', nextAction = 'obNext', disabled = false;
  if (step === 0) {
    body = `<div class="ob-hero"><img src="icons/apple-touch-icon.png" alt=""><h1>Study Planner</h1>
      <p>Add your units and assessments. Get a week-by-week plan, with a plain-English reason for every hour.</p></div>
      <div class="features">
        <div>${ICON.brain}<p style="margin:0"><b>Explains itself</b><span>Every choice comes with a reason you can read.</span></p></div>
        <div>${ICON.plane}<p style="margin:0"><b>Works offline</b><span>Plan on the train, even in airplane mode.</span></p></div>
        <div>${ICON.lock}<p style="margin:0"><b>Private</b><span>Everything stays on this iPhone. No account needed.</span></p></div>
      </div>`;
    next = 'Get started';
  } else if (step === 1) {
    body = `<h1 class="ob-q">When does your semester start?</h1>
      <p class="ob-help">We've filled in Monash's usual pattern: 12 teaching weeks, SWOTVAC, then 3 exam weeks.</p>${semesterFields()}`;
  } else if (step === 2) {
    body = `<h1 class="ob-q">How many hours a week can you study?</h1>
      <p class="ob-help">Outside of class time. Mark busy weeks with fewer hours.</p>${hoursFields()}`;
  } else if (step === 3) {
    const list = state.units.map((u) => `<div class="row" style="${unitColor(u)};--inset:40px"><span class="dot"></span>
      <span class="grow"><div class="title">${esc(u.code)}</div>${u.name ? `<div class="sub">${esc(u.name)}</div>` : ''}</span>
      <button class="nav-btn" style="color:var(--red)" data-action="obRemoveUnit" data-id="${u.id}" aria-label="Remove ${esc(u.code)}">Remove</button></div>`).join('');
    body = `<h1 class="ob-q">Which units are you taking?</h1>
      <p class="ob-help">Add each unit code, for example ENG2005, MTE2204, ECW1102.</p>
      <div class="group">
        <label class="row"><span>Code</span><input class="value" id="ob-code" placeholder="ENG2005" autocapitalize="characters" autocomplete="off" spellcheck="false" enterkeyhint="next" aria-label="Unit code"></label>
        <label class="row"><span>Name</span><input class="value" id="ob-name" placeholder="Optional" enterkeyhint="done" aria-label="Unit name"></label>
        <button class="row action" data-action="obAddUnit">${ICON.plus}<span>Add unit</span></button>
      </div>
      ${state.units.length ? `<div class="section-header">Your Units</div><div class="group">${list}</div>` : ''}`;
    disabled = !state.units.length;
  } else if (step === 4) {
    body = `<h1 class="ob-q">Rank them from hardest to easiest</h1>
      <p class="ob-help">Drag the handles. Harder units get more time.</p>${rankList()}`;
  } else if (step === 5) {
    state.obUnit = clamp(state.obUnit, 0, state.units.length - 1);
    const u = state.units[state.obUnit];
    body = `<div class="unit-chip-row" style="${unitColor(u)}"><span class="dot"></span><span class="muted small">Unit ${state.obUnit + 1} of ${state.units.length}</span></div>
      <h1 class="ob-q">Tell us about ${esc(u.code)}</h1>
      <p class="ob-help">How you feel now, what's assessed, and what the exam is like. Tap an assessment to edit it. Exam dates usually come out late, so the final exam starts as "date not known yet" (Week ${tentativeWeekOf(state.semester)} for now).</p>${unitFields(u)}`;
  } else {
    const rows = plan.unitSummaries.map((s) => {
      const u = unitById(s.unitId);
      return `<div class="group" style="padding:14px 16px;margin-bottom:12px;${unitColor(u)}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span class="dot"></span><b class="grow" style="flex:1">${esc(u.code)}</b><span class="badge">${s.share}% · ${fmtH(s.total)}</span></div>
        <div class="stack"><i style="width:${s.share}%"></i></div>
        <ul class="reason-list">${s.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>`;
    }).join('');
    const total = plan.weeks.reduce((s, w) => s + w.allocated, 0);
    body = `<h1 class="ob-q">Your plan is ready</h1>
      <p class="ob-help">${fmtH(total)} across ${plan.weeks.length} weeks. Here's why each unit got its share.</p>${rows}`;
    next = 'Start studying';
    nextAction = 'obFinish';
  }
  const back = step > 0 ? `<button class="nav-btn glass interactive circle" data-action="obBack" aria-label="Back">${ICON.back}</button>` : '';
  return `
    <header class="navbar always"><div class="nav-left">${back}</div></header>
    ${step > 0 ? `<div class="ob-progress" aria-hidden="true"><i style="width:${obProgress() * 100}%"></i></div>` : ''}
    <main class="screen no-tabs">${body}</main>
    <div class="footer-bar"><div class="inner"><button class="btn glass prominent interactive" data-action="${nextAction}" ${disabled ? 'disabled' : ''}>${next}</button></div></div>`;
}

function obNext() {
  if (state.obStep === 3 && !state.units.length) return;
  if (state.obStep === 5 && state.obUnit < state.units.length - 1) state.obUnit++;
  else { state.obStep = Math.min(OB_LAST, state.obStep + 1); state.obUnit = 0; }
  commit();
}
function obBack() {
  if (state.obStep === 5 && state.obUnit > 0) state.obUnit--;
  else if (state.obStep === 6) { state.obStep = 5; state.obUnit = Math.max(0, state.units.length - 1); }
  else state.obStep = Math.max(0, state.obStep - 1);
  commit();
}

// ---------- Sheets ----------

let openSheetEl = null;

function openSheet({ title, body, onSave, onCancel, saveLabel = 'Save', cancelLabel = 'Cancel', noSave = false, replace = false }) {
  // Refresh an open sheet in place (no slide animation) when its content changes.
  if (replace && openSheetEl) {
    openSheetEl.sheet.querySelector('.sheet-body').innerHTML = body;
    fitSheet(openSheetEl.sheet);
    return;
  }
  closeSheet(true);
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', title.replace(/<[^>]+>/g, ''));
  sheet.innerHTML = `<div class="sheet-grabber"></div>
    <div class="sheet-head"><button class="nav-btn" data-sheet="cancel" style="justify-self:start">${cancelLabel}</button><h2>${title}</h2>
      ${noSave ? '<span></span>' : `<button class="nav-btn" data-sheet="save">${saveLabel}</button>`}</div>
    <div class="sheet-body">${body}</div>`;
  document.body.append(backdrop, sheet);
  void sheet.offsetHeight;
  backdrop.classList.add('open');
  sheet.classList.add('open');
  openSheetEl = { sheet, backdrop, onCancel };
  fitSheet(sheet);
  backdrop.addEventListener('click', () => closeSheet(false, true));
  sheet.querySelector('[data-sheet=cancel]').addEventListener('click', () => closeSheet(false, true));
  sheet.querySelector('[data-sheet=save]')?.addEventListener('click', () => { if (onSave?.(sheet) !== false) closeSheet(); });
  enableSwipeDown(sheet);
  sheet.querySelector('input:not([type=checkbox]):not([type=date]):not([type=number])')?.focus({ preventScroll: true });
}

/** Full-height sheets turn opaque and attach to the screen edges, as in iOS 26. */
function fitSheet(sheet) {
  sheet.classList.toggle('full', sheet.scrollHeight > window.innerHeight * 0.72);
}

function closeSheet(instant = false, cancelled = false) {
  if (!openSheetEl) return;
  const { sheet, backdrop, onCancel } = openSheetEl;
  openSheetEl = null;
  if (cancelled) onCancel?.();
  if (instant) { sheet.remove(); backdrop.remove(); return; }
  sheet.classList.remove('open');
  backdrop.classList.remove('open');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => { sheet.remove(); backdrop.remove(); }, reduced ? 0 : 420);
}

function enableSwipeDown(sheet) {
  const head = sheet.querySelector('.sheet-head');
  const grab = sheet.querySelector('.sheet-grabber');
  for (const el of [head, grab]) {
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const y0 = e.clientY;
      sheet.style.transition = 'none';
      const move = (ev) => { sheet.style.transform = `translateY(${Math.max(0, ev.clientY - y0)}px)`; };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        sheet.style.transition = '';
        sheet.style.transform = '';
        if (ev.clientY - y0 > 90) closeSheet(false, true);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
      window.addEventListener('pointercancel', up, { once: true });
    });
  }
}

// ---------- Drag to reorder ----------

function enableReorder(list) {
  list.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.handle');
    if (!handle) return;
    const row = handle.closest('[data-id]');
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    let startY = e.clientY;
    row.classList.add('dragging');
    const move = (ev) => {
      let dy = ev.clientY - startY;
      const next = row.nextElementSibling;
      const prev = row.previousElementSibling;
      if (next && dy > next.offsetHeight / 2) { next.after(row); startY += next.offsetHeight; dy = ev.clientY - startY; }
      else if (prev && dy < -prev.offsetHeight / 2) { prev.before(row); startY -= prev.offsetHeight; dy = ev.clientY - startY; }
      row.style.transform = `translateY(${dy}px)`;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      row.classList.remove('dragging');
      row.style.transform = '';
      const order = [...list.querySelectorAll('[data-id]')].map((r) => r.dataset.id);
      const changed = order.some((id, i) => state.units[i]?.id !== id);
      if (changed) {
        state.units = order.map((id) => unitById(id));
        commit();
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up, { once: true });
    handle.addEventListener('pointercancel', up, { once: true });
  });
}

// ---------- Events ----------

const editsFor = (id) => state.taskEdits[id] || {};
function setEdit(id, patch) {
  const e = { ...editsFor(id), ...patch };
  for (const k of Object.keys(e)) if (e[k] == null) delete e[k];
  if (Object.keys(e).length) state.taskEdits[id] = e; else delete state.taskEdits[id];
}

const actions = {
  tab: (el) => { ui.tab = el.dataset.tab; ui.unitId = null; if (ui.tab === 'week') ui.week = null; render(); },
  prevWeek: () => { ui.week = (ui.week ?? displayWeek()) - 1; render(); },
  nextWeek: () => { ui.week = (ui.week ?? displayWeek()) + 1; render(); },
  thisWeek: () => { ui.week = null; render(); },
  gotoWeek: (el) => { ui.week = Number(el.dataset.week); ui.tab = 'week'; render(); },
  toggleTask: (el) => {
    const id = el.dataset.id;
    const t = findTask(id);
    if (state.progress[id]?.status === 'done' || (t && isComplete(t))) delete state.progress[id];
    else state.progress[id] = { status: 'done', at: todayISO() };
    commit();
  },
  openTask: (el) => openTaskSheet(el.dataset.id),
  setTask: (el) => {
    const { id, v } = el.dataset;
    const p = state.progress[id] || {};
    const partial = Number(p.doneHours) > 0 && p.status !== 'done';
    if (v === 'done') state.progress[id] = { status: 'done', at: todayISO() };
    else if (v === 'missed') state.progress[id] = { ...p, status: 'missed', at: todayISO() };
    else if (v === 'unmiss' && partial) state.progress[id] = { status: 'partial', doneHours: p.doneHours, at: todayISO() };
    else delete state.progress[id];
    closeSheet();
    commit();
    if (v === 'missed') toast(partial ? 'The rest moves to catch-up time' : 'Moved forward to catch-up time');
  },
  taskDone: (el) => {
    const { id } = el.dataset;
    const t = findTask(id);
    if (!t) return;
    const p = state.progress[id] || {};
    const cur = p.status === 'done' ? t.hours : Number(p.doneHours) || 0;
    const next = clamp(cur + Number(el.dataset.d), 0, t.hours);
    if (next >= t.hours - 1e-9) state.progress[id] = { status: 'done', at: todayISO() };
    else if (next <= 0) { if (p.status === 'missed') state.progress[id] = { status: 'missed', at: p.at }; else delete state.progress[id]; }
    else state.progress[id] = { status: p.status === 'missed' ? 'missed' : 'partial', doneHours: next, at: todayISO() };
    commit();
    openTaskSheet(id, true);
  },
  taskDay: (el) => {
    const { id, v } = el.dataset;
    setEdit(id, { day: Number(v) });
    commit();
    openTaskSheet(id, true);
  },
  taskHours: (el) => {
    const { id } = el.dataset;
    const t = findTask(id);
    if (!t) return;
    const w = plan.weeks[t.week - 1];
    const h = clamp(t.hours + Number(el.dataset.d), 0.5, t.hours + w.free);
    setEdit(id, { hours: Math.abs(h - t.plannedHours) < 1e-9 ? null : h });
    commit();
    openTaskSheet(id, true);
  },
  taskReset: (el) => {
    const { id } = el.dataset;
    delete state.taskEdits[id];
    commit();
    openTaskSheet(id, true);
  },
  toggleDayOff: (el) => {
    const d = el.dataset.date;
    const off = state.blocked.includes(d);
    state.blocked = off ? state.blocked.filter((x) => x !== d) : [...state.blocked, d].sort();
    commit();
    toast(off ? `${fmtDate(d, { weekday: 'long' })} is a study day again` : `${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'short' })} is now a day off`);
  },
  removeDayOff: (el) => { state.blocked = state.blocked.filter((x) => x !== el.dataset.date); commit(); },
  addDayOffSheet: () => addDayOffSheet(),
  toggleStudyDay: (el) => {
    const d = Number(el.dataset.d);
    const days = [...state.prefs.studyDays];
    if (days[d] && days.filter(Boolean).length === 1) { toast('Keep at least one study day'); return; }
    days[d] = !days[d];
    state.prefs = { ...state.prefs, studyDays: days };
    commit();
  },
  dailyStep: (el) => {
    const d = Number(el.dataset.d);
    const cur = state.prefs.dailyMax;
    let next;
    if (cur == null) next = d > 0 ? Math.max(1, Math.ceil(Number(state.hours.perWeek) / state.prefs.studyDays.filter(Boolean).length)) : null;
    else next = cur + d < 1 ? null : clamp(cur + d, 1, 16);
    state.prefs = { ...state.prefs, dailyMax: next };
    commit();
  },
  setSession: (el) => { state.prefs = { ...state.prefs, sessionLength: Number(el.dataset.v) }; commit(); },
  openCheckin: () => openCheckin(),
  openReadiness: () => openReadiness(),
  rdBrush: (el) => {
    rdBrush = Number(el.dataset.v);
    el.closest('.rd-brush').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
  },
  rdKey: (el, e) => { // keyboard / switch control (pointer taps are handled by painting)
    if (e.detail !== 0) return;
    const cur = el.dataset.v ? Number(el.dataset.v) : null;
    painting = { v: cur === rdBrush ? null : rdBrush, changed: false };
    paintCell(el);
    endPaint();
  },
  rdFillReady: () => {
    for (const w of rateableWeeks()) for (const u of state.units) if (!currentReadiness(u, w.week)) setReadiness(u, w.week, 3);
    recompute();
    saveState(state).catch(() => {});
    openReadiness(true);
  },
  quickRate: (el) => {
    const box = el.closest('.rd-quick');
    const pressed = el.getAttribute('aria-pressed') === 'true';
    box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === el && !pressed)));
    if (el.closest('.checkin')) return; // saved with the check-in
    const u = unitById(box.dataset.unit);
    setReadiness(u, Number(box.dataset.week), pressed ? null : Number(el.dataset.v));
    commit();
    toast(pressed ? 'Rating cleared' : `Week ${box.dataset.week}: ${READY_LABEL[el.dataset.v]}`);
  },
  checkinPick: (el) => {
    const g = el.closest('.checkin');
    g.querySelectorAll('[data-action=checkinPick]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    const labels = ['Lost', 'Shaky', 'Okay', 'Good', 'Solid'];
    g.querySelector('.ci-label').textContent = `${el.dataset.v}/5 · ${labels[el.dataset.v - 1]}`;
  },
  openUnit: (el) => { ui.unitId = el.dataset.id; render(); },
  back: () => { ui.unitId = null; render(); },
  addUnitSheet: () => addUnitSheet(),
  addAssessment: (el) => assessmentSheet(el.dataset.unit, null),
  editAssessment: (el) => assessmentSheet(el.dataset.unit, el.dataset.id),
  deleteAssessment: (el) => {
    const u = unitById(el.dataset.unit);
    u.assessments = u.assessments.filter((a) => a.id !== el.dataset.id);
    closeSheet();
    commit();
  },
  dueMode: (el) => {
    const sheet = el.closest('.sheet');
    sheet.querySelectorAll('[data-action=dueMode]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    sheet.querySelector('.due-week').classList.toggle('hidden', el.dataset.v === 'date');
    sheet.querySelector('.due-date').classList.toggle('hidden', el.dataset.v !== 'date');
  },
  tbcToggle: (el) => {
    const sheet = el.closest('.sheet');
    const tbc = el.checked;
    const byDate = sheet.querySelector('[data-action="dueMode"][data-v="date"]').getAttribute('aria-pressed') === 'true';
    sheet.querySelector('.due-mode').classList.toggle('hidden', tbc);
    sheet.querySelector('.due-week').classList.toggle('hidden', tbc || byDate);
    sheet.querySelector('.due-date').classList.toggle('hidden', tbc || !byDate);
    sheet.querySelector('.due-help').textContent = tbc
      ? `Planned for Week ${tentativeWeekOf(state.semester)} for now. You'll see it under "Dates to confirm" until you add the real date.`
      : 'If you only know the week, Friday is assumed.';
  },
  doneToggle: (el) => { el.closest('.sheet').querySelector('.score-row').classList.toggle('hidden', !el.checked); },
  setConfidence: (el) => {
    const u = unitById(el.dataset.unit);
    const v = Number(el.dataset.v);
    if (state.onboarded && rawCurrentWeek() >= 1) logConfidence(u, v); else u.confidence = v;
    commit();
  },
  setBook: (el) => { unitById(el.dataset.unit).exam.book = el.dataset.v; commit(); },
  deleteUnit: (el) => {
    const u = unitById(el.dataset.unit);
    if (!confirm(`Delete ${u.code} and its assessments?`)) return;
    state.units = state.units.filter((x) => x !== u);
    ui.unitId = null;
    commit();
  },
  cycleWeekType: (el) => {
    const i = Number(el.dataset.week) - 1;
    const order = ['teaching', 'break', 'swotvac', 'exam'];
    state.semester.weeks[i] = order[(order.indexOf(state.semester.weeks[i]) + 1) % order.length];
    commit();
  },
  addWeek: () => { state.semester.weeks.push('exam'); commit(); },
  removeWeek: () => {
    if (state.semester.weeks.length <= 1) return;
    delete state.hours.overrides[state.semester.weeks.length];
    state.semester.weeks.pop();
    commit();
  },
  resetWeeks: () => { state.semester.weeks = defaultSemester(state.semester.startDate).weeks; commit(); },
  hoursStep: (el) => { state.hours.perWeek = clamp(Number(state.hours.perWeek) + Number(el.dataset.d), 0, 80); commit(); },
  editWeekHours: (el) => editWeekHoursSheet(Number(el.dataset.week)),
  clearWeekHours: (el) => { delete state.hours.overrides[el.dataset.week]; closeSheet(); commit(); },
  exportData: () => exportData(),
  importData: () => document.getElementById('import-file')?.click(),
  resetAll: async () => {
    if (!confirm('Erase all units, plans and progress from this device?')) return;
    await clearState();
    state = freshState();
    state.persisted = await requestPersistence();
    ui.tab = 'week'; ui.week = null; ui.unitId = null;
    commit();
  },
  obNext: () => obNext(),
  obBack: () => obBack(),
  obAddUnit: () => {
    const code = document.getElementById('ob-code');
    const name = document.getElementById('ob-name');
    if (tryAddUnit(code.value, name.value)) { commit(); document.getElementById('ob-code')?.focus(); }
  },
  obRemoveUnit: (el) => { state.units = state.units.filter((u) => u.id !== el.dataset.id); commit(); },
  obFinish: () => {
    state.onboarded = true;
    state.trackFrom = Math.max(1, rawCurrentWeek());
    state.checkins[state.trackFrom] = 'setup';
    ui.tab = 'week'; ui.week = null;
    commit();
  },
};

const hoursOrNull = (v) => {
  const n = numOrNull(v);
  return n == null || n <= 0 ? null : clamp(Math.round(n * 2) / 2, 0.5, 80);
};

// Return 'quiet' to save and re-plan without re-rendering (keeps the keyboard up while typing).
const changes = {
  startDate: (el) => { if (el.value) state.semester.startDate = mondayOf(el.value); },
  tentativeWeek: (el) => { state.semester.tentativeWeek = Number(el.value) || DEFAULT_TENTATIVE_WEEK; },
  unitCode: (el) => {
    const code = cleanCode(el.value);
    const u = unitById(el.dataset.unit);
    if (!code || state.units.some((x) => x !== u && x.code === code)) { toast('Enter a different unit code'); return; }
    u.code = code;
  },
  unitName: (el) => { unitById(el.dataset.unit).name = el.value.trim(); },
  examFormat: (el) => { unitById(el.dataset.unit).exam.format = el.value; },
  hurdleOn: (el) => { unitById(el.dataset.unit).exam.hurdle = el.checked ? 45 : null; },
  hurdlePct: (el) => { unitById(el.dataset.unit).exam.hurdle = clamp(Number(el.value) || 45, 1, 100); },
  pastPapers: (el) => { unitById(el.dataset.unit).exam.pastPapers = el.checked; },
  minHours: (el) => {
    const u = unitById(el.dataset.unit);
    u.minHours = hoursOrNull(el.value);
    if (u.minHours != null && u.maxHours != null && u.minHours > u.maxHours) toast('The minimum is above the maximum, so the maximum wins');
  },
  maxHours: (el) => {
    const u = unitById(el.dataset.unit);
    u.maxHours = hoursOrNull(el.value);
    if (u.minHours != null && u.maxHours != null && u.minHours > u.maxHours) toast('The minimum is above the maximum, so the maximum wins');
  },
  topic: (el) => {
    const u = unitById(el.dataset.unit);
    const v = el.value.trim().slice(0, 60);
    u.topics = { ...(u.topics || {}) };
    if (v) u.topics[el.dataset.week] = v; else delete u.topics[el.dataset.week];
    return 'quiet';
  },
  checkinOn: (el) => { state.prefs = { ...state.prefs, checkin: el.checked }; },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  if (el.type !== 'checkbox') e.preventDefault(); // let switches toggle
  fn(el, e);
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'import-file' && el.files?.[0]) { importFile(el.files[0]); el.value = ''; return; }
  const fn = changes[el.dataset?.change];
  if (!fn) return;
  if (fn(el) === 'quiet') { recompute(); saveState(state).catch(() => {}); } else commit();
});

// Remember which collapsible sections are open across re-renders.
document.addEventListener('toggle', (e) => {
  const key = e.target.dataset?.key;
  if (key) ui.open[key] = e.target.open;
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'ob-code') { e.preventDefault(); document.getElementById('ob-name')?.focus(); }
  else if (e.target.id === 'ob-name') { e.preventDefault(); actions.obAddUnit(); }
  else if (e.target.closest('.sheet') && e.target.tagName === 'INPUT') {
    e.preventDefault();
    e.target.closest('.sheet').querySelector('[data-sheet=save]')?.click();
  }
});

let lastScrollY = 0;
function onScroll() {
  const y = window.scrollY;
  const bar = document.getElementById('tabbar');
  if (bar) {
    if (y < 40 || lastScrollY - y > 6) bar.classList.remove('mini');
    else if (y - lastScrollY > 6 && y > 120) bar.classList.add('mini');
  }
  lastScrollY = y;
  document.body.classList.toggle('scrolled', y > 36);
  const t = root.querySelector('.large-title');
  if (t) {
    const p = clamp(y / 44, 0, 1);
    t.style.transform = `scale(${1 - p * 0.12})`;
    t.style.opacity = String(1 - p);
  }
}
window.addEventListener('scroll', onScroll, { passive: true });

// Re-plan when the app comes back to the foreground on a new day (the week may have changed).
let lastDay = todayISO();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state && todayISO() !== lastDay) {
    lastDay = todayISO();
    recompute();
    render();
    if (needsCheckin()) setTimeout(openCheckin, 400);
  }
});

// ---------- Boot ----------

async function init() {
  let saved = null;
  try { saved = await loadState(); } catch (e) { console.warn('IndexedDB unavailable', e); }
  if (saved) {
    state = normalize(saved);
  } else {
    state = freshState();
    state.persisted = await requestPersistence(); // first launch
  }
  recompute();
  render();
  if (!saved) saveState(state).catch(() => {});
  if (needsCheckin()) setTimeout(openCheckin, 400);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker failed', e));
  });
}

init();
