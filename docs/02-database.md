# Database

Postgres via Supabase. The migrations are in `supabase/migrations/` and are tested in `packages/db` (PGlite) on every `npm test`.

| Migration | Contents |
|---|---|
| `20261008000100_core_schema.sql` | Tables, constraints, indexes, triggers |
| `20261008000200_rls.sql` | Row-level security policies and grants |
| `20261008000300_sync.sql` | `sync_push`, `sync_pull` and the upsert helper |
| `20261008000400_phone_signoff.sql` | PIN sign-off from the intern's phone; the server owns verified/returned status |
| `20261008000500_assessments.sql` | KMPDC rotation assessment forms |
| `20261008000600_internship_forms.sql` | End-of-internship (5.8) and completion (5.9) forms |
| `20261008000700_case_reports.sql` | Case reports; verifications target an entry or a case report |
| `20261008000800_treatment_plans.sql` | Treatment plans; sync reads its table list from the `sync_table` registry |
| `20261012000900_supervisor_accounts.sql` | Invites, supervisor read access, `supervisor_queue`, `supervisor_sign`, owner-filtered pull |

## Personal mode

In the MVP every row belongs to one intern (`owner_id = auth.uid()`). The facility is not yet the data controller. Institutional mode (V4) adds encrypted identity columns in a separate migration; personal mode deliberately has **no column** for patient names, contacts or ID numbers. A test asserts the exact column list of `patient`.

## Tables

| Table | Purpose | Notes |
|---|---|---|
| `profile` | One row per account | Created by a trigger on `auth.users` |
| `facility` | Training centre | |
| `internship` | Intern identity for forms, period, requirement set | `period_to >= period_from` |
| `supervisor` | Supervisor names the intern picks | `user_id` links a supervisor's own account (V1) |
| `rotation` | Calendar with extensions | `ends_on >= starts_on`, `extended_by_days >= 0` |
| `patient` | **Pseudonymous**: hospital no., birth year, sex, systemic-condition flag, structured alerts | `unique (owner_id, ref)` |
| `encounter` | A patient visit | `visit_type`, `setting` and `time` are checked |
| `encounter_procedure`, `finding`, `investigation` | Children of an encounter, replaced on each push | Cascade on encounter delete |
| `activity` | Evidence without a patient: postmortem, sessions, calls, talks, community items, case steps, weekly reports | Community item 1–16, report 1–8 |
| `logbook_entry` | Derived entry per code | Exactly one source: an encounter or an activity |
| `verification` | Supervisor decision on a logbook entry **or** a case report (exactly one) | **Append-only**; a returned decision requires a comment; sets the target's status |
| `case_report` | Case report (5.x.5): title, date, linked visits, sections (JSON) | Status set only by verifications; content locked once verified |
| `treatment_plan` | Per-patient plan with items (JSON): phase, treatment, teeth, status, stage, handover note | Owner-only; synced through the `sync_table` registry |
| `supervisor_invite` | One-time code linking a supervisor record to the supervisor's account | Only the SHA-256 of the code is stored; single use, 7-day expiry |
| `assessment` | Rotation forms and internship forms (5.8, 5.9) | One live form per slot; grades and answers as JSON keyed by form item |
| `reflection` | Reflection diary | |
| `report_snapshot` | Finalised report | SHA-256 checked as 64 hex characters |
| `audit_log` | Who did what to which row | **No clinical content**; append-only |

Common columns on synced tables:

| Column | Meaning |
|---|---|
| `owner_id` | Set from `auth.uid()` on insert; cannot change on update |
| `server_seq` | Global sync cursor from `sync_seq`, stamped on every insert and update |
| `server_received_at` | Server receive time; the device's own timestamps are kept separately for clock-skew checks |
| `deleted_at` | Soft delete; clients never hard-delete parent rows |

## Triggers

| Trigger | Effect |
|---|---|
| `sync_stamp` (all synced tables) | Stamps `server_seq` and `server_received_at`; pins the owner on insert and freezes it on update. A verification's owner is the intern who owns the entry, not the signing supervisor. |
| `audit` (all synced tables) | Writes `(actor, insert/update, table, row id)` to `audit_log` |
| `entry_guard` (`logbook_entry`) | Only a supervisor verification (`app.verifying = on`) can set `verified`/`locked`. A verified entry's code, date, patient no., site, level and status cannot change; the reason given is "add a correction instead". |
| `verification_append_only`, `audit_append_only` | Updates and deletes are refused, even for administrators |
| `child_owner` | Encounter children inherit the caller as owner |
| `on_auth_user_created` | Creates the profile |

## Row-level security

| Table group | Intern (authenticated) | Anonymous |
|---|---|---|
| Synced parent tables | select, insert, update **own rows** | none |
| Encounter children | select, insert, update, delete **own rows** | none |
| `verification` | select verifications of **own entries** | none |
| `audit_log` | select **own actions** | none |
| `profile` | select and update **own profile** | none |

RLS is `forced`, so it also applies to the table owner role through PostgREST. The tests cover cross-account reads, overwriting another intern's record by guessing its ID, and ownership spoofing.

**V1 additions:** a supervisor policy (entries where `supervisor.user_id = auth.uid()`, with only the source encounter visible), a coordinator policy (counts only, masked patient numbers), and `verify_entry()` as a security-definer function that sets `app.verifying`, appends to the hash chain and updates the entry status.

## Running locally

With Docker running:

```bash
npx supabase start
```

To apply migrations to a linked project:

```bash
npx supabase db push
```

To run the migration tests without Docker:

```bash
npm test -w @logbook/db
```
