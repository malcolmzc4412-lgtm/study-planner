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
2. **This Week**: tasks grouped by day. Tick them off. Tap a task to see why it's there, or mark it **missed**. Missed hours move to later weeks as catch-up time; nothing is dropped. Anything left unticked when a week ends also rolls forward.
3. **Plan**: the whole semester at a glance, coloured by unit, with assessment markers. Tap a week to open it.
4. **Units**: tap a unit to see its score breakdown, hours per week, assessments and the reasons behind its time.
5. **Settings**: change semester weeks and hours, re-rank units, export/import a backup, or reset.

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

Then these rules apply:

1. Unfinished work carried forward is placed first (up to half the week).
2. In teaching weeks every unit gets a small **baseline** (up to 2h) so lectures aren't missed.
3. The rest is split **in proportion to the scores**.
4. No unit gets more than **50% of a week** unless one of its assessments is due that week.
5. Work for an assessment is **never scheduled after its due date**.
6. Hours become tasks: learn new content, practice problems, assignment work, past papers, and **spaced review** of topics from 1, 3 and 7 weeks earlier.
7. In **SWOTVAC and exam weeks** time goes to past papers and revision, ordered by exam date. A unit whose exams are finished gets no more time.
8. The weekly total never exceeds the hours you set.

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
| `styles.css` | iOS 26 "Liquid Glass" styling, light and dark mode |
| `app.js` | Screens, onboarding, sheets, events |
| `scheduler.js` | The planning engine (pure functions, no DOM) |
| `db.js` | IndexedDB storage and `navigator.storage.persist()` |
| `sw.js` | Service worker: caches every file for offline use |
| `manifest.webmanifest` | App name, icons, standalone display |
| `icons/` | Home Screen icons (180, 192, 512 px) |
| `tests/` | `node:test` tests for the scheduler |
