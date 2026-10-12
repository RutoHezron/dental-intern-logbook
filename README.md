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
| **Supervisors on their own phone** | The intern invites a supervisor with a one-time code, shown as a link and a QR code to scan chairside. The supervisor signs in on their own phone or computer, sees only what was submitted to them (with the visit's procedures and diagnosis), and verifies, adjusts the level or returns with a comment. Their sign-offs form their own hash chain, ordered by the server so two devices can never fork it, and reach the intern's phone at the next sync. |
| **Coordinator cohort view** | Opt-in and revocable: an intern shares their progress with their internship coordinator using a one-time code. The coordinator sees, per intern, verified entries toward the minimums (computed by the same rules as the intern's dashboard), codes met and behind pace, assessment forms held and due, case reports, returned entries and plain flags for attention. They never receive entries, patient numbers, visits, the diary or reports, and the intern always sees who has access. |
| **Daily push reminders** | Opt-in per device (Settings, or the supervisor's queue). One notification a day at most, with counts and an in-app link only — returned entries, entries waiting over a week, a few quiet days, or items waiting for a supervisor — so nothing clinical appears on a locked screen. Sent by a scheduled Edge Function. |
| **Printed KMPDC pages** | The case and procedure log (5.x.4), case-report log, and community logs (5.7.4–5.7.6) in the book's layout. Rows are filled from verified entries in date order at the supervisor's observed level, padded to the book's row count, with continuation sheets, a digital verification reference per row and an integrity code per table — ready for the wet signature and stamp. |
| **Assessment forms** | Monthly, mid-rotation, end-of-rotation (graded 0–3, with reasons required for 0 or 1) and overall assessments for every rotation. Identity and dates are pre-filled, the supervisor's progress remark can be drafted from the logbook, a progress snapshot is attached as evidence, due dates and status are tracked, and forms print in the book's layout. |
| **Case reports** | Ten per rotation, as the logbook expects. Started from a patient's visits, the facts (age and sex, complaint, findings, investigations, diagnosis, procedures with dates and levels, referral) are drafted without copying the hospital number; the intern writes the discussion. Verified with the same PIN sign-off and hash chain as logbook entries, locked once verified, and filling the printed *Log of Case Reports*. |
| **End of internship** | 5.8 End of internship evaluation and 5.9 Verification of completion, pre-filled with identity and the rotation dates from the calendar (including extensions), plus a *Ready for KMPDC?* checklist: rotations finished, forms complete, every rotation recorded as completed, minimums met, and no entries left open. |
| **Android app** | The same app wrapped with Capacitor, kept separately in `apps/mobile`. Data stays in app-private storage, and Android cloud backup is disabled. |
| **Treatment plans & handover** | A phased plan per patient (urgent, disease control, definitive, maintenance, review) built from treatments and teeth, never from logbook codes. Logging a visit updates matching items, including root canal stages; the plan is closed only by the intern. Before a returning patient's visit a next-visit brief shows the last visit, work in progress, what is planned next and alerts. **Today** lists overdue and due items, and **Handover** lists patients with unfinished treatment before the rotation ends, with a note and receiving intern, and prints. |
| **Sync (optional)** | Outbox-based offline sync to Supabase/Postgres with email one-time-code sign-in. Status shows synced, pending or error. |

## Repository layout

```
packages/core   Domain engine (pure TypeScript): KMPDC catalogue, mapping and counting
                rules, validation, verification hash chain, statistics, progress,
                insights, reports, portfolio, CSV export, sync wire format,
                synthetic demo internship.
apps/web        React PWA: screens, IndexedDB store (Dexie), repository, sync engine.
apps/mobile     Android app (Capacitor): native project in android/, packages the apps/web build.
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

This runs 225 unit and integration tests across three packages:

| Package | Tests | Covers |
|---|---|---|
| `@logbook/core` | 136 | Catalogue integrity (42 codes / 762 minimums), the blueprint's worked mapping examples, counting rules, reconciliation, hash chain, validation and the identifier guard, periods, compounding (weekly and monthly sums equal the cumulative total), reports, snapshots, portfolio wording, treatment plan updates and handover lists, account sign-off chains, timestamp round trips, cohort progress equal to the intern's own, deterministic synthetic data |
| `@logbook/db` | 53 | Real migrations in PGlite: no identity columns on patients, push/pull round trip, cursors, tombstones, per-change rejection, row-level isolation, ownership pinning, verified-entry guard, append-only verifications, audit trail, supervisor invites and linking, what a supervisor can read, account sign-off with chain-head checks, coordinator shares (aggregates only, revocable), push reminders (counts-only digests, once a day, sender-only access) and the sender's outcome handling |
| `@logbook/web` | 36 | Repository against IndexedDB (including PIN sign-off and its hash chain), on-phone storage and backup reminders, Quick Entry UI flow, and the sync engine end to end (device ↔ Postgres, second-device restore, sign-off synced, edits to verified entries refused, local-edit protection, PIN kept across syncs), the supervisor-account journey (invite, accept, sign, intern pulls), push opt-in and the service-worker reminder handler |

The end-to-end browser tests (25) run against the production build with the service worker, using the locally installed Chrome:

```bash
npm run test:e2e -w @logbook/web
```

### Production build

```bash
npm run build -w @logbook/web
```

The output in `apps/web/dist` is static files. See [docs/04-deployment.md](docs/04-deployment.md).

### Android app

The Android app lives in `apps/mobile`, separate from the web app; it packages the `apps/web` build.

Requirements: Android Studio, which provides the SDK, and a Java 21 JDK (Gradle 8.14 cannot run on the Java 25 that recent Android Studio versions bundle; set it under Settings → Build Tools → Gradle → Gradle JDK).

To build the web app, copy it into the Android project and open it in Android Studio:

```bash
npm run android:sync
```

```bash
npm run android:open
```

Then use **Run** or **Build → Build APK(s)**. From the command line, with `JAVA_HOME` pointing at the Java 21 JDK:

```bash
npm run android:apk
```

The debug APK is written to `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`. The first build downloads Gradle and the Android build tools, about 500 MB.

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

The MVP (M1–M4) is complete, with phone-first storage and the Android app shell. V1 so far adds supervisor sign-off on the phone, printed KMPDC logbook pages, the rotation assessment forms, the end-of-internship and completion forms (5.8, 5.9) with a readiness checklist, case reports, treatment plans with next-visit briefs and rotation handover, supervisor accounts (supervisors verify from their own phone, invited by code or QR), and the coordinator cohort view and daily push reminders. Still to come for the web app: the AI gateway (V3), institutional mode (V4) and other professions (V5). See [docs/01-architecture.md § Roadmap](docs/01-architecture.md#roadmap).

Counting rules R1–R10 are **defaults** until a training centre confirms them (KMPDC does not define them), and the app labels them that way. Procedure counts show recorded exposure; the app does not certify competence.
