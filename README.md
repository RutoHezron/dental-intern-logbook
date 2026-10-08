# Dental Intern Logbook

A clinical logbook, reflection diary and progressive reporting app for dental interns, built around the **KMPDC National Guidelines and Logbook for Dental Interns (3rd edition, 2024)**.

> **Enter once → organise automatically → analyse automatically → report automatically → build the portfolio as you go.**

An intern logs a visit in under a minute: patient number, teeth, procedure, their level and the supervisor. The app works out which KMPDC logbook codes the visit counts toward, using transparent rules. Code progress, weekly, monthly and rotation reports, cumulative internship statistics, competency tracking and the final portfolio then follow from those entries. Nothing is typed twice.

**The logbook lives on the intern's phone.** On first launch the app sets up its database on the phone and asks the system to keep it permanently. It works with no signal and no account. The Android app also backs itself up every day to `Documents/DentalLogbook` on the phone. Signing in to a sync server is optional and adds backup and multi-device use.

> **Privacy by design.** No patient names, phone numbers or ID numbers are collected, only the hospital number the paper logbook already asks for. All demo data is fictional.

---

## What's in the box

| Area | What it does |
|---|---|
| **Quick Entry** | FDI tooth chart, procedure favourites, a five-step level picker (L1 observed → L5 independent, never pre-selected), and a live preview of the codes a visit will log and why. Also data-quality and patient-identifier warnings, and "Save & next". |
| **Logbook** | Every visit and activity, searchable by patient no., procedure, tooth, diagnosis, code or supervisor, with filters for rotation, status, level and dates. Also a per-code view of logged, verified and at-expected-level counts, plus a forecast. |
| **Competencies** | Level matrix per code (brief §6–7). Shows uncoded KMPDC expectations (orthodontics, prosthodontics, general) and exposure across all procedures. |
| **Reflection diary** | Structured prompts with ⭐ 📚 ⚠️ 🧠 🏆 tags. These feed reports and the portfolio. |
| **Reports** | Weekly, monthly, rotation, whole-internship and custom reports. Each shows **this period, the previous period and the cumulative total** side by side. Print to PDF, CSV export, and hash-sealed "finalised" copies. |
| **Portfolio** | Internship overview, a month-by-month progress timeline, procedure portfolio, strengths and gaps (worded as *recorded exposure*), learning journey, and a reflection draft in which every sentence cites the data it uses. |
| **Dashboard** | Headline numbers, reminders, an activity chart, current-rotation codes and pace, insights labelled *recorded data* or *interpretation*, and exposure gaps per rotation. |
| **Rotations** | Calendar with extensions; entries move to the matching rotation automatically. Supervisors and objectives. |
| **Phone storage** | On-device database set up at first launch, with persistent storage requested and shown (location, size, kept permanently). Native app: automatic daily backups to `Documents/DentalLogbook`, last 7 kept, restorable. Browser: share-sheet backups and a weekly reminder. |
| **Supervisor sign-off** | On the intern's phone and offline: the supervisor reviews pending entries with prompts (late, duplicate, paediatric age, first jump to a high level…), verifies, adjusts the level or returns with a comment, and signs with their own PIN. Each decision becomes a hash-chained verification. |
| **Printed KMPDC pages** | The case and procedure log (5.x.4), case-report log, and community logs (5.7.4–5.7.6) in the book's layout. Rows are filled from verified entries in date order at the supervisor's observed level, padded to the book's row count, with continuation sheets, a digital verification reference per row and an integrity code per table — ready for the wet signature and stamp. |
| **Assessment forms** | Monthly, mid-rotation, end-of-rotation (graded 0–3, with reasons required for 0 or 1) and overall assessments for every rotation. Identity and dates are pre-filled, the supervisor's progress remark can be drafted from the logbook, a progress snapshot is attached as evidence, due dates and status are tracked, and forms print in the book's layout. |
| **Android app** | The same app wrapped with Capacitor (`apps/web/android`). Data stays in app-private storage, and Android cloud backup is disabled. |
| **Sync (optional)** | Outbox-based offline sync to Supabase/Postgres with email one-time-code sign-in. Status shows synced, pending or error. |

## Repository layout

```
packages/core   Domain engine (pure TypeScript): KMPDC catalogue, mapping and counting
                rules, validation, verification hash chain, statistics, progress,
                insights, reports, portfolio, CSV export, sync wire format,
                synthetic demo internship.
apps/web        React PWA: screens, IndexedDB store (Dexie), repository, sync engine.
supabase/       Postgres migrations (schema, row-level security, sync functions), CLI config.
packages/db     Migration tests: runs supabase/migrations in PGlite (Postgres in WASM).
docs/           Proposal, architecture, database, sync API, deployment, user guide, security.
```

## Getting started

Requirements: Node 20 or later. Docker is needed only for the optional local sync server.

```bash
npm install
```

```bash
npm run dev -w @logbook/web
```

Open http://localhost:5173 and choose **Open the demo** (Dr Alex Mwangi, a fictional 12-month internship with about 1,000 visits) or **Set up my internship**.

### Tests

```bash
npm test
```

This runs 161 unit and integration tests across three packages:

| Package | Tests | Covers |
|---|---|---|
| `@logbook/core` | 111 | Catalogue integrity (42 codes / 762 minimums), the blueprint's worked mapping examples, counting rules, reconciliation, hash chain, validation and the identifier guard, periods, compounding (weekly and monthly sums equal the cumulative total), reports, snapshots, portfolio wording, deterministic synthetic data |
| `@logbook/db` | 24 | Real migrations in PGlite: no identity columns on patients, push/pull round trip, cursors, tombstones, per-change rejection, row-level isolation, ownership pinning, verified-entry guard, append-only verifications, audit trail |
| `@logbook/web` | 26 | Repository against IndexedDB (including PIN sign-off and its hash chain), on-phone storage and backup reminders, Quick Entry UI flow, and the sync engine end to end (device ↔ Postgres, second-device restore, sign-off synced, edits to verified entries refused, local-edit protection) |

The end-to-end browser tests (19) run against the production build with the service worker, using the locally installed Chrome:

```bash
npm run test:e2e -w @logbook/web
```

### Production build

```bash
npm run build -w @logbook/web
```

The output in `apps/web/dist` is static files. See [docs/04-deployment.md](docs/04-deployment.md).

### Android app

Requirements: Android Studio, which provides the SDK and Java.

To build the web app, copy it into the Android project and open it in Android Studio:

```bash
npm run android:sync -w @logbook/web
```

```bash
npm run android:open -w @logbook/web
```

Then use **Run** or **Build → Build APK(s)**. From the command line, with `JAVA_HOME` pointing at Android Studio's `jbr` folder:

```bash
npm run android:apk -w @logbook/web
```

The debug APK is written to `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`. The first build downloads Gradle and the Android build tools, about 500 MB.

### Optional: local sync server

1. Start Docker Desktop.
2. Run `npx supabase start` from the repository root. It applies `supabase/migrations` automatically.
3. Copy the printed API URL and anon key into `apps/web/.env`, using `apps/web/.env.example` as the template.
4. Restart the dev server.
5. Sign in under **Settings → Account & sync**. Codes arrive in the local mail viewer at http://localhost:54324.

## Documentation

| Document | Contents |
|---|---|
| [00 Architecture proposal](docs/00-architecture-proposal.md) | Discovery, how the brief and the blueprint were reconciled, stack choice, phasing |
| [01 Architecture](docs/01-architecture.md) | How the system is built and why; data flow; offline and sync design |
| [02 Database](docs/02-database.md) | Schema, constraints, triggers, row-level security |
| [03 Sync API](docs/03-sync-api.md) | `sync_push` / `sync_pull` contract and wire format |
| [04 Deployment](docs/04-deployment.md) | Hosting the app and the database; configuration; backups |
| [05 User guide](docs/05-user-guide.md) | For interns: logging, reports, portfolio, sync |
| [06 Security & privacy](docs/06-security-privacy.md) | Data minimisation, controls, legal context, open items |

## Status

The MVP (M1–M4) is complete, with phone-first storage and the Android app shell. V1 so far adds supervisor sign-off on the phone, printed KMPDC logbook pages and the assessment forms. Still to come in V1: case reports, treatment plans with next-visit briefs, the end-of-internship and completion forms (5.8, 5.9), and server-side supervisor accounts. See [docs/01-architecture.md § Roadmap](docs/01-architecture.md#roadmap).

Counting rules R1–R10 are **defaults** until a training centre confirms them (KMPDC does not define them), and the app labels them that way. Procedure counts show recorded exposure; the app does not certify competence.
