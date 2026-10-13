# Study Planner

A study planner for your iPhone. Add your university units, and it spreads your study time across the semester, week by week. Every decision comes with a short, plain-English reason, for example:

> ENG2005 gets 8.5h: ranked hardest, confidence 2/5, 50% exam with hurdle in Week 15.

It's a Progressive Web App (PWA): a website you install from Safari onto your Home Screen. You don't need a Mac, the App Store or Xcode.

- **Works offline.** After the first visit it runs in airplane mode.
- **Private.** Everything is stored on your phone (IndexedDB). No accounts, no tracking, no network calls.
- **No build step.** Plain HTML, CSS and JavaScript.

---

## Put it on your iPhone

You need a free GitHub account. GitHub Pages gives the app a free `https://` address, which iPhones require before they'll install a web app.

### 1. Put the files on GitHub

**Option A: in the browser (no Git needed)**

1. Go to <https://github.com/new>.
2. Name the repository, e.g. `study-planner`. Set it to **Public**. Click **Create repository**.
3. On the new repo page, click **uploading an existing file**.
4. Drag in **everything** in this folder: `index.html`, `styles.css`, `app.js`, `scheduler.js`, `db.js`, `sw.js`, `manifest.webmanifest`, `README.md`, and the `icons` and `tests` folders.
5. Click **Commit changes**.

**Option B: with Git**

```bash
git init
git add .
git commit -m "Study Planner"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/study-planner.git
git push -u origin main
```

### 2. Turn on GitHub Pages

1. In your repository, click **Settings** (top bar) → **Pages** (left sidebar).
2. Under **Build and deployment** → **Source**, choose **Deploy from a branch**.
3. Under **Branch**, pick **main** and **/ (root)**. Click **Save**.
4. Wait 1–2 minutes and refresh. GitHub shows the link: `https://YOUR-USERNAME.github.io/study-planner/`.

### 3. Install it on your iPhone

1. Open the link in **Safari**. It must be Safari, not Chrome or an in-app browser.
2. Wait for the page to finish loading. This first visit saves the app for offline use.
3. Tap the **Share** button (square with an up arrow). On iOS 26 it may be under the **⋯** button.
4. Scroll down and tap **Add to Home Screen**.
5. If you see **Open as Web App**, make sure it's **on**. Tap **Add**.
6. Open **Study Planner** from your Home Screen and follow the set-up questions.

### Updating the app later

Upload the changed files to GitHub again (or `git push`). Next time you open the app with internet, it picks up the new version. If you add or rename files, also add them to the `FILES` list in `sw.js` and change `CACHE` (e.g. `study-planner-v2`).

### Back up your data

Your plan lives only on your phone. **Deleting the Home Screen app deletes its data.** Use **Settings → Export backup** now and then, and save the file to Files or iCloud Drive. **Import backup…** restores it.

---

## Using it

1. **Set-up** asks one thing per screen: semester dates (Monash's 12 teaching weeks + SWOTVAC + 3 exam weeks are filled in), hours per week and busy weeks, your units, a hardest-to-easiest ranking, then each unit's confidence, assessments and exam details.
2. **This Week**: tasks grouped by day. Tick them off. Tap a task to see why it's there, mark it **missed**, log **partial progress** ("did 1h of 2h"), or **move it** to another day and change its length. Missed and unfinished hours move to later weeks as catch-up time; nothing is dropped. Tap a day chip to take that day **off**.
3. **Calendar**: an Apple Calendar-style month view. Each day shows a coloured dot for each unit with work that day (faded when it's all done), a diamond for assessments due, and a red circle on today. Tap a day to see and tick its tasks, or to take it off. Swipe left or right to change month. **List** shows the month day by day, starting from today.
4. **Plan**: the whole semester at a glance, coloured by unit, with assessment markers. Dashed **TBC** markers are assessments whose date isn't announced yet. Tap a week to open it.
5. **Units**: tap a unit to see its score breakdown, hours per week, assessments and the reasons behind its time. Each unit can also have:
   - **Hours limits**: at least / at most so many hours a week.
   - **Weekly topics**: e.g. "W5: Laplace transforms", so tasks say "Review: Laplace transforms".
   - **Results**: mark an assessment finished and enter your mark. Low marks give the unit more time. Once every non-exam mark is in, it tells you what you need on the exam to pass.
6. **Settings**: semester weeks and hours, **study days**, a **max per day**, **session length** (45m–3h), **days off**, ranking, the **weekly check-in**, backup and reset.

### Editing tasks to suit you

Tap any task to change it:

- **Rename it** (the original title is shown as a hint) and **add notes**, such as which questions, page numbers or links.
- **Move it** to another day or **change its length**. The rest of the week is planned around your change.
- **Reset to the plan** undoes all of that.

**Add your own tasks** with *Add your own task* on This Week, or *Add a task on this day* in the Calendar. Give each one a title, a unit (or none), a date, a length and notes. Your own tasks use part of that week's study hours, and the planned work shrinks to fit around them. The reasons say so, e.g. *Includes your own task: "Redo tutorial 3" (1.5h)*. A missed own task with a unit rolls forward like any other work.

### Dates not announced yet

Exam timetables come out late, so every new unit's Final exam starts as **Date not known yet**. Any assessment can be switched to this in its edit sheet. These are planned for **Week 14** for now (you can change that week in Settings → *Unknown dates go in*), shown under **Dates to confirm** on This Week, and marked TBC on the Plan. When you add the real date, the plan rebalances by itself.

### Week readiness

Rate how ready you feel for each week's content: **Not yet**, **Shaky** or **Ready**. Open it from the *Week Readiness* card on This Week, or from a unit's page.

- Pick a colour, then **tap or drag down a column** to paint weeks. Tap a rated week again to clear it.
- **Mark the rest as ready** fills every unrated week in one tap, so you only have to mark the weak ones.
- The weekly check-in asks about last week's content with one tap per unit, and review tasks ask "How ready is Week N now?"

How ratings change your plan:

- **Not yet**: the planner adds *"Relearn Week N: lecture & notes"* and then *"Exercises: Week N"*, starting **today**. In the current week these tasks are only placed on today or later. They keep coming each week until you rate the week better.
- **Shaky**: adds *"Exercises: Week N"*.
- **Ready**: the week skips its later spaced reviews.
- Weak weeks lead your SWOTVAC revision ("Revise weak spots: …"), and a unit with weak weeks gets a little more time overall.
- A **worse** rating applies from today. A **better** rating applies from next week, so recovery tasks already planned (or done) this week stay put.

### Weekly check-in

The first time you open the app each week, it asks how confident you feel in each unit (1–5). The plan changes from that week on; earlier weeks keep what you said at the time. You can skip it, turn it off, or check in any time from Settings.

## How the scheduler decides

`scheduler.js` is a set of pure, rule-based functions. There's no AI and nothing random, so the same inputs always give the same plan.

Each week, every unit gets a **priority score**:

| Factor | Effect |
|---|---|
| Difficulty rank | Hardest unit +3 points, scaling down to the easiest |
| Confidence gap | +0.75 per point below 5/5 |
| Assessment weight | +2 per 100% of weight still to come |
| Urgency | Ramps up over the 3 weeks before each assessment (25% → 50% → 80% → 100%) |
| Hurdle | A hurdled exam counts 1.5× |
| Your marks | Average below 70% adds up to +1.5; well above it takes off up to 0.75 (only after the marked assessment) |
| Week readiness | +0.5 per week rated "not yet", +0.25 per "shaky", −0.1 per "ready" (between −0.5 and +2). Weak weeks also get re-learning and exercise tasks (up to 45% of the unit's week). |

Then these rules apply:

1. Unfinished work carried forward is placed first (up to half the week).
2. In teaching weeks every unit gets a small **baseline** (up to 2h) so lectures aren't missed.
3. The rest is split **in proportion to the scores**.
4. No unit gets more than **50% of a week** unless one of its assessments is due that week.
5. Work for an assessment is **never scheduled after its due date**.
6. Hours become tasks: learn new content, practice problems, assignment work, past papers, and **spaced review** of topics from 1, 3 and 7 weeks earlier.
7. In **SWOTVAC and exam weeks** time goes to past papers and revision, ordered by exam date. A unit whose exams are finished gets no more time.
8. The weekly total never exceeds the hours you set, or what your study days × max per day can hold.
9. Your own limits win: a unit's minimum and maximum hours, tasks you moved or resized, and days off are all respected, and the reasons say so.
10. Finished assessments get no more time. An assessment with an unknown date is planned for the tentative week (default Week 14).

## For developers

Run the tests (Node 18+, no installs needed):

```bash
node --test tests/
```

Run it locally:

```bash
python3 -m http.server
```

Then open <http://localhost:8000>. On Windows, use `python` instead of `python3`.

| File | What it does |
|---|---|
| `index.html` | Page shell, iOS meta tags, manifest link |
| `styles.css` | iOS 26 Liquid Glass styling, light and dark mode. Glass is only used for the floating tab bar, bar buttons, controls, sheets and toasts: a clear, vivid backdrop, an unevenly lit rim, an inner lens glow, and a sheen that drifts as you scroll. Backdrop filters are written out literally, because older Safari ignores them when they come from CSS variables. Safari can't do true refraction. Respects Reduce Transparency, Increase Contrast and Reduce Motion. |
| `app.js` | Screens, onboarding, sheets, events |
| `scheduler.js` | The planning engine (pure functions, no DOM) |
| `db.js` | IndexedDB storage and `navigator.storage.persist()` |
| `sw.js` | Service worker: caches every file for offline use |
| `manifest.webmanifest` | App name, icons, standalone display |
| `icons/` | Home Screen icons (180, 192, 512 px) |
| `tests/` | `node:test` tests for the scheduler |
